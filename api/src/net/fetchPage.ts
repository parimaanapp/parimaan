import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { ValidatedUrl, SafeUrlDeps } from './safeUrl.js';
import { validateSafeUrl } from './safeUrl.js';

/** A descriptive, contactable User-Agent identifying Parimaan — never a spoofed browser string (E2E_MVP_PLAN.md §13.2.14). */
export const USER_AGENT = 'Parimaan/1.0 (+https://parimaan.app)';

export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_BYTES = 1_000_000;
export const DEFAULT_MAX_REDIRECTS = 3;

const HTML_CONTENT_TYPE_PATTERN = /text\/html|application\/xhtml\+xml/i;

export interface FetchPageOptions {
  /** Total budget across the initial request AND every redirect hop — not per-request (E2E_MVP_PLAN.md §13.2.10's "8s total budget"). */
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
}

export interface TransportResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export interface FetchPageDeps extends SafeUrlDeps {
  /**
   * Injectable transport — defaults to `defaultTransport` (a real,
   * IP-pinned HTTPS request). Tests inject a stub to simulate redirects,
   * oversized bodies, slow/never-completing responses, and non-HTML
   * content types without a real network call or real elapsed time.
   */
  transport?: (validated: ValidatedUrl, remainingMs: number, maxBytes: number) => Promise<TransportResult>;
}

/**
 * Deliberately NOT exercised against a real socket in this package's unit
 * tests — same convention `ai/geminiClient.ts` established for the
 * identical class of concern (real outbound I/O): stubbed everywhere in
 * `fetchPage.test.ts` via the `transport` seam, and proven for real only
 * during a real dev-AWS pass (S12), not with a self-signed-cert local test
 * harness this codebase has no other precedent for.
 *
 * The real HTTPS transport, pinned to `validated.address` (the DNS
 * address `validateSafeUrl` already checked) via `hostname`, while
 * `servername`/the `Host` header carry the original hostname for TLS SNI
 * and virtual-hosting — the standard IP-pinning mitigation for the window
 * between DNS validation and connect (DNS rebinding, §13.2.10). Node
 * validates the TLS certificate against `servername`, not `hostname`, so
 * certificate validation is unaffected by connecting to a raw IP.
 *
 * Streams the response and aborts (destroys the request) the instant the
 * accumulated body would exceed `maxBytes` — a 2MB response is aborted
 * partway through, not read to completion and then rejected. The abort
 * deadline is an explicit `setTimeout` at exactly `remainingMs`, NOT
 * `options.timeout` — `http(s).request`'s own `timeout` option is a
 * socket **idle** timer (resets on every byte of activity), not an
 * absolute wall-clock deadline; a server that drip-feeds one byte just
 * inside that window on every reset could otherwise hold the connection
 * open indefinitely, defeating the "8s total budget" this module
 * documents everywhere else (flagged by `typescript-reviewer` against
 * exactly that scenario). The explicit timer is what actually bounds a
 * server that accepts the connection and either sends nothing, or sends
 * just enough to keep resetting an idle timer, without ever completing.
 */
/** Streams one response's body, aborting `req` and rejecting the instant the accumulated size would exceed `maxBytes` — split out of `defaultTransport` purely to keep that function under this codebase's complexity ceiling. */
const streamResponseBody = (
  req: ClientRequest,
  res: IncomingMessage,
  maxBytes: number,
  resolve: (result: TransportResult) => void,
  reject: (error: Error) => void,
): void => {
  const chunks: Buffer[] = [];
  let total = 0;
  res.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBytes) {
      req.destroy();
      reject(new Error('Response exceeded the size cap.'));
      return;
    }
    chunks.push(chunk);
  });
  res.on('end', () => {
    resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
  });
  res.on('error', reject);
};

export const defaultTransport = (validated: ValidatedUrl, remainingMs: number, maxBytes: number): Promise<TransportResult> =>
  new Promise((resolve, reject) => {
    const { url, address } = validated;
    const options: RequestOptions = {
      hostname: address,
      servername: url.hostname,
      headers: { Host: url.hostname, 'User-Agent': USER_AGENT, Accept: 'text/html' },
      path: `${url.pathname}${url.search}`,
      port: 443,
      method: 'GET',
    };

    let settled = false;
    // `finish` guarantees exactly one of resolve/reject ever fires and the
    // deadline timer is always cleared — without this, a race between the
    // deadline firing and the response completing (or erroring) at nearly
    // the same instant could otherwise call both.
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      action();
    };

    const req = httpsRequest(options, (res) =>
      streamResponseBody(
        req,
        res,
        maxBytes,
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error)),
      ),
    );
    const deadlineTimer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new Error('Request timed out.')));
    }, remainingMs);
    req.on('error', (error) => finish(() => reject(error)));
    req.end();
  });

const extractHeader = (headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | null => {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
};

const isRedirectStatus = (status: number): boolean => status >= 300 && status < 400;
const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

/**
 * The bounded, SSRF-safe fetcher behind `importRecipeFromUrl` (S5,
 * E2E_MVP_PLAN.md §13.2.10). Re-runs `validateSafeUrl`'s FULL gate on
 * every redirect hop, not just the initial URL — "the control most often
 * omitted and the one that most often matters," per that section's own
 * framing: a public URL redirecting to `http://169.254.169.254/` is
 * rejected the moment that hop is validated, before any request to it is
 * ever attempted. Follows at most `maxRedirects` hops (default 3); a
 * response at 4xx/5xx (including 429) is a plain failure with no retry.
 *
 * Returns `null` for every failure — validation rejection, transport
 * error, wrong content-type, non-2xx status, too many redirects — never
 * throws and never distinguishes *why* (the identical "never an oracle"
 * contract `validateSafeUrl` documents). The caller (the resolver) maps
 * `null` to one generic client-facing failure; the fetched bytes
 * themselves are never returned on any path, success or failure — only
 * `fetchPage`'s own caller ever sees the HTML, and only on success.
 */
type HopOutcome = { readonly kind: 'success'; readonly body: string } | { readonly kind: 'redirect'; readonly nextUrl: string } | { readonly kind: 'fail' };

/** Resolves a 3xx response's `Location` header against `baseUrl` into the next hop's outcome — split out of `performOneHop` purely to keep it under this codebase's complexity ceiling. */
const resolveRedirectOutcome = (result: TransportResult, baseUrl: URL, isLastAllowedHop: boolean): HopOutcome => {
  if (isLastAllowedHop) return { kind: 'fail' }; // one more hop would exceed the redirect cap
  const location = extractHeader(result.headers, 'location');
  if (location === null) return { kind: 'fail' };
  try {
    return { kind: 'redirect', nextUrl: new URL(location, baseUrl).toString() };
  } catch {
    return { kind: 'fail' };
  }
};

const resolveResponseOutcome = (result: TransportResult): HopOutcome => {
  if (!isSuccessStatus(result.status)) return { kind: 'fail' };
  const contentType = extractHeader(result.headers, 'content-type');
  if (contentType === null || !HTML_CONTENT_TYPE_PATTERN.test(contentType)) return { kind: 'fail' };
  return { kind: 'success', body: result.body };
};

/** One validate-then-request cycle against `currentUrl`, isolated from the redirect-loop's own bookkeeping (hop counting, the shared deadline) purely to keep `fetchPage` itself under this codebase's complexity ceiling. */
const performOneHop = async (
  currentUrl: string,
  isLastAllowedHop: boolean,
  remainingMs: number,
  maxBytes: number,
  transport: NonNullable<FetchPageDeps['transport']>,
  deps: SafeUrlDeps,
): Promise<HopOutcome> => {
  const validated = await validateSafeUrl(currentUrl, deps);
  if (validated === null) return { kind: 'fail' };

  let result: TransportResult;
  try {
    result = await transport(validated, remainingMs, maxBytes);
  } catch {
    return { kind: 'fail' };
  }

  return isRedirectStatus(result.status) ? resolveRedirectOutcome(result, validated.url, isLastAllowedHop) : resolveResponseOutcome(result);
};

/** Runs the redirect loop given an already-resolved config — split out of `fetchPage` purely to keep that (the exported, documented entry point) under this codebase's complexity ceiling. */
const runRedirectLoop = async (
  rawUrl: string,
  deadline: number,
  maxBytes: number,
  maxRedirects: number,
  transport: NonNullable<FetchPageDeps['transport']>,
  deps: FetchPageDeps,
): Promise<string | null> => {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;

    const outcome = await performOneHop(currentUrl, hop === maxRedirects, remainingMs, maxBytes, transport, deps);
    switch (outcome.kind) {
      case 'success':
        return outcome.body;
      case 'fail':
        return null;
      case 'redirect':
        currentUrl = outcome.nextUrl;
    }
  }
  return null;
};

export const fetchPage = (rawUrl: string, options: FetchPageOptions = {}, deps: FetchPageDeps = {}): Promise<string | null> =>
  runRedirectLoop(
    rawUrl,
    Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    options.maxBytes ?? DEFAULT_MAX_BYTES,
    options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    deps.transport ?? defaultTransport,
    deps,
  );
