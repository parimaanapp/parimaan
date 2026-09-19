import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { AiConfig } from './config.js';
import { loadAiConfig } from './config.js';

// Real call, W19 S1 (real photos, real endpoint, not assumed): this same
// text model accepts inline image parts and returns real, reasonable
// pantry-item identifications — no separate vision-only model id exists or
// is needed. Confirmed twice against two real pantry/fridge photos: both
// calls succeeded (~2.3s), correctly named nearly every real item present
// (potatoes/onions/garlic; curry leaves/chillies/corn/carrots/cucumbers/
// ginger/coriander), at ~1,150 prompt tokens per image (~$0.0003-0.0005/call
// at this model's published per-token price) — real numbers, not estimated.
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GeminiApiKeySecretJson {
  apiKey: string;
}

const isGeminiApiKeySecretJson = (value: unknown): value is GeminiApiKeySecretJson =>
  typeof value === 'object' &&
  value !== null &&
  'apiKey' in value &&
  typeof (value as { apiKey: unknown }).apiKey === 'string';

/**
 * Fetches the Gemini API key from the Secrets Manager secret the founder
 * creates out-of-band (`parimaan/gemini-api-key`) — same fetch-and-narrow
 * shape as `db/pool.ts`'s `fetchAppRolePasswordFromSecretsManager`, the
 * established pattern for exactly this "secret lives in Secrets Manager,
 * fetched once per cold start" job (§13.2.2 point 3).
 */
const fetchGeminiApiKeyFromSecretsManager = async (secretArn: string): Promise<string> => {
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (result.SecretString === undefined) {
    throw new Error(`Secret ${secretArn} has no SecretString value.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.SecretString);
  } catch (cause) {
    throw new Error(`Secret ${secretArn} does not contain valid JSON.`, { cause });
  }

  if (!isGeminiApiKeySecretJson(parsed)) {
    throw new Error(`Secret ${secretArn} does not have the expected shape.`);
  }
  return parsed.apiKey;
};

export interface GeminiClientDeps {
  /** Defaults to `loadAiConfig()` (real `process.env`). Overridable for tests. */
  config?: AiConfig;
  /** Defaults to fetching from Secrets Manager. Overridable for tests. */
  fetchApiKey?: (secretArn: string) => Promise<string>;
  /** Defaults to the global `fetch`. Overridable for tests — never hits the real network. */
  fetchImpl?: typeof fetch;
}

/**
 * Module-scope memoized key promise — mirrors `db/pool.ts`'s memoized
 * `poolPromise`. A single Lambda execution environment reuses this module
 * across warm invocations, so the key is fetched from Secrets Manager once
 * per container, not once per call.
 */
let apiKeyPromise: Promise<string> | undefined;

const getApiKey = async (deps: GeminiClientDeps): Promise<string> => {
  apiKeyPromise ??= (deps.fetchApiKey ?? fetchGeminiApiKeyFromSecretsManager)(
    (deps.config ?? loadAiConfig()).geminiApiKeySecretArn,
  );
  return apiKeyPromise;
};

/** Test-only: clears the memoized key so the next call fetches fresh. No production equivalent — a warm Lambda never tears this down. */
export const resetGeminiClientForTesting = (): void => {
  apiKeyPromise = undefined;
};

/**
 * Thrown for any Gemini response `invokeModel.ts`'s transport retry chain
 * should retry: HTTP 429/500/503, or the fetch itself failing (network
 * error, or the caller's own `AbortSignal` firing on a deadline it set).
 * Never thrown for a successful-but-unparseable response — that is
 * `invokeModel.ts`'s own output-chain job, not this client's.
 */
export class GeminiTransportError extends Error {}

/**
 * Thrown for HTTP 401/403 — the provider rejected the credential or the
 * request outright. `invokeModel.ts` never retries this class; it maps
 * straight to `AiUnavailableError`, since a bad/revoked key won't start
 * working on attempt 2.
 */
export class GeminiAuthError extends Error {}

/**
 * Token counts for one Gemini call — W19 D6's own cost-metering input.
 * Deliberately best-effort (see `extractUsageFromGeminiResponse`): a
 * metering gap must never turn into a broken recipe parse or a broken
 * pantry-vision call, so this is `{ promptTokens: 0, candidateTokens: 0 }`
 * rather than a throw when Gemini's response shape doesn't carry
 * `usageMetadata` for some reason.
 */
export interface GeminiUsage {
  promptTokens: number;
  candidateTokens: number;
}

export interface GeminiCallResult {
  /** The model's raw text output — not yet JSON.parsed. `invokeModel.ts` owns markdown-fence-stripping and parsing (provider-neutral concerns). */
  rawText: string;
  /** W19 D6: real token counts, for `invokeModel.ts` to turn into a real cost-metric emission after a successful call. */
  usage: GeminiUsage;
}

/**
 * One inline image part for a multimodal `callGemini` call (W19 D2) —
 * Gemini's own `inline_data` shape, base64-encoded, sent alongside the text
 * prompt as an additional `parts` entry. `mimeType` is caller-supplied
 * rather than sniffed here, since the caller (e.g. a future `analyzePantryPhoto`
 * resolver, W20) already knows the real content type of what it uploaded.
 */
export interface GeminiImageInput {
  mimeType: string;
  base64Data: string;
}

/**
 * One Gemini API call, no retry logic — `invokeModel.ts` (provider-neutral)
 * owns every retry/deadline decision; this function's only job is "make one
 * HTTP call, map the response to a typed result or a typed error." Sends
 * the key via the `x-goog-api-key` header, never a URL query param (coding
 * rule: never put secrets in a URL).
 *
 * `responseMimeType: 'application/json'` is Gemini's own structured-output
 * mode — reduces malformed output but is never treated as the validation
 * boundary (§13.2.5, D4); `invokeModel.ts`'s Zod layer is authoritative
 * regardless of what this flag does or doesn't guarantee.
 *
 * `options.images` (W19 D2) — optional inline image parts, appended after
 * the text prompt. Confirmed via two real calls against real pantry photos
 * that the one existing `GEMINI_MODEL` constant already handles this; no
 * second, vision-only model id exists in this client.
 */
const toInlineDataParts = (images: GeminiImageInput[] | undefined): { inline_data: { mime_type: string; data: string } }[] =>
  (images ?? []).map((image) => ({ inline_data: { mime_type: image.mimeType, data: image.base64Data } }));

export const callGemini = async (
  prompt: string,
  options: { timeoutMs: number; images?: GeminiImageInput[] },
  deps: GeminiClientDeps = {},
): Promise<GeminiCallResult> => {
  const apiKey = await getApiKey(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const imageParts = toInlineDataParts(options.images);

  let response: Response;
  try {
    response = await fetchImpl(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    // Network failure or the AbortSignal firing — both are transport-chain
    // retryable per §13.2.7 (the deadline-gating in invokeModel.ts is what
    // decides whether a retry is actually attempted, not this catch).
    throw new GeminiTransportError('Gemini request failed (network error or timeout).', { cause });
  }

  if (response.status === 401 || response.status === 403) {
    throw new GeminiAuthError(`Gemini rejected the request (HTTP ${response.status}).`);
  }
  if (response.status === 429 || response.status === 500 || response.status === 503) {
    throw new GeminiTransportError(`Gemini returned a transient error (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    // Any other non-2xx (e.g. a 400 our own request shape caused) is not
    // transport-retryable — retrying the identical malformed request would
    // just fail identically. Not a Gemini-specific case §13.2.7 names, so it
    // surfaces as a generic failure for invokeModel.ts to map to AI_UNAVAILABLE
    // rather than looping the transport chain against it.
    throw new Error(`Gemini returned HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  const rawText = extractTextFromGeminiResponse(body);
  const usage = extractUsageFromGeminiResponse(body);
  return { rawText, usage };
};

/**
 * Narrows Gemini's `generateContent` response shape down to the one string
 * `invokeModel.ts` needs — `candidates[0].content.parts[0].text`. Anything
 * else (empty `candidates`, a safety-filtered response with no `parts`)
 * throws rather than returning `undefined` silently, so a shape Gemini
 * changes on us again (§13.2.2's own lesson from today) fails loudly
 * instead of producing a confusing downstream JSON.parse error.
 */
const extractTextFromGeminiResponse = (body: unknown): string => {
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini response has no candidates.');
  }
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('Gemini response candidate has no content parts.');
  }
  const text = (parts[0] as { text?: unknown }).text;
  if (typeof text !== 'string') {
    throw new Error('Gemini response part has no text.');
  }
  return text;
};

/**
 * Reads `usageMetadata.promptTokenCount`/`candidatesTokenCount` — the exact
 * field names confirmed against a real response during W19 S1's own live
 * verification. Deliberately best-effort, unlike `extractTextFromGeminiResponse`:
 * this function backs a cost *metric*, not the actual AI output the caller
 * needs to function — a missing/malformed `usageMetadata` degrades to
 * `{ promptTokens: 0, candidateTokens: 0 }` (an under-reported cost metric
 * for that one call) rather than failing a real, otherwise-successful
 * recipe parse or pantry-vision call over a metering gap.
 */
const extractUsageFromGeminiResponse = (body: unknown): GeminiUsage => {
  const usageMetadata = (body as { usageMetadata?: unknown }).usageMetadata;
  if (typeof usageMetadata !== 'object' || usageMetadata === null) {
    return { promptTokens: 0, candidateTokens: 0 };
  }
  const { promptTokenCount, candidatesTokenCount } = usageMetadata as {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
  };
  return {
    promptTokens: typeof promptTokenCount === 'number' ? promptTokenCount : 0,
    candidateTokens: typeof candidatesTokenCount === 'number' ? candidatesTokenCount : 0,
  };
};
