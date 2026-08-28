import { describe, expect, it, vi } from 'vitest';
import type { ResolvedAddress } from './safeUrl.js';
import { fetchPage } from './fetchPage.js';
import type { TransportResult } from './fetchPage.js';

const PUBLIC_ADDRESS = '93.184.216.34';
const resolvesTo = (...addresses: string[]) => async (_hostname: string): Promise<ResolvedAddress[]> =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const html = (status = 200, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }, body = '<html>ok</html>'): TransportResult => ({
  status,
  headers,
  body,
});

describe('fetchPage — validation gate', () => {
  it('returns null immediately for a URL that fails the SSRF gate, never invoking the transport', async () => {
    const transport = vi.fn();
    const result = await fetchPage('http://example.com/', {}, { transport });
    expect(result).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('fetchPage — happy path', () => {
  it('returns the body on a well-formed HTML 200 response', async () => {
    const transport = vi.fn().mockResolvedValue(html(200, { 'content-type': 'text/html' }, '<html><body>recipe</body></html>'));
    const result = await fetchPage('https://example.com/recipe', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBe('<html><body>recipe</body></html>');
  });

  it('accepts application/xhtml+xml as HTML-ish', async () => {
    const transport = vi.fn().mockResolvedValue(html(200, { 'content-type': 'application/xhtml+xml' }));
    const result = await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).not.toBeNull();
  });
});

describe('fetchPage — content-type and status handling', () => {
  it('rejects a non-HTML content-type (e.g. application/pdf)', async () => {
    const transport = vi.fn().mockResolvedValue(html(200, { 'content-type': 'application/pdf' }));
    expect(await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport })).toBeNull();
  });

  it('rejects a response with no content-type header at all', async () => {
    const transport = vi.fn().mockResolvedValue(html(200, {}));
    expect(await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport })).toBeNull();
  });

  it('surfaces a 429 as a plain failure, with no retry', async () => {
    const transport = vi.fn().mockResolvedValue(html(429));
    expect(await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport })).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a 500 with no retry', async () => {
    const transport = vi.fn().mockResolvedValue(html(500));
    expect(await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport })).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('propagates a transport-level failure (e.g. size cap or timeout) as null', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('Response exceeded the size cap.'));
    expect(await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport })).toBeNull();
  });
});

describe('fetchPage — redirect handling', () => {
  it('follows a single redirect and re-validates the new URL before fetching it', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/real-recipe' }))
      .mockResolvedValueOnce(html(200, { 'content-type': 'text/html' }, 'final page'));
    const result = await fetchPage('https://example.com/short-link', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBe('final page');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('resolves a relative redirect Location against the current URL', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(html(301, { location: '/final' }))
      .mockResolvedValueOnce(html(200, { 'content-type': 'text/html' }, 'final page'));
    const result = await fetchPage('https://example.com/start', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBe('final page');
  });

  it('allows exactly 3 redirects (4 total requests)', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop1' }))
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop2' }))
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop3' }))
      .mockResolvedValueOnce(html(200, { 'content-type': 'text/html' }, 'landed'));
    const result = await fetchPage('https://example.com/start', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBe('landed');
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('rejects a 4th redirect (more than 3 hops)', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop1' }))
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop2' }))
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop3' }))
      .mockResolvedValueOnce(html(302, { location: 'https://example.com/hop4' }));
    const result = await fetchPage('https://example.com/start', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBeNull();
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('rejects a redirect with no Location header', async () => {
    const transport = vi.fn().mockResolvedValueOnce(html(302, {}));
    expect(await fetchPage('https://example.com/', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport })).toBeNull();
  });

  it('the single most important test: a public URL redirecting to an internal-metadata address is rejected on the redirect hop, and that hop is never fetched', async () => {
    const transport = vi.fn().mockResolvedValueOnce(html(302, { location: 'http://169.254.169.254/latest/meta-data/' }));
    const result = await fetchPage('https://example.com/looks-safe', {}, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBeNull();
    // Only the first (safe) hop was ever actually requested — the
    // malicious redirect target was rejected by re-validation before a
    // second transport call could ever be made.
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect to a private IP-literal target even when disguised as a relative-looking path is not applicable — absolute redirect to a private hostname is re-validated too', async () => {
    const transport = vi.fn().mockResolvedValueOnce(html(302, { location: 'https://internal.example.com/' }));
    const resolveHostname = vi.fn(async (hostname: string) =>
      hostname === 'example.com' ? [{ address: PUBLIC_ADDRESS, family: 4 }] : [{ address: '10.1.2.3', family: 4 }],
    );
    const result = await fetchPage('https://example.com/start', {}, { resolveHostname, transport });
    expect(result).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPage — the 8s budget is total, across all hops, not per-request', () => {
  it('stops making further hops once the shared deadline is exhausted', async () => {
    const transport = vi.fn().mockImplementation(async () => html(302, { location: 'https://example.com/next' }));
    const result = await fetchPage('https://example.com/start', { timeoutMs: 0 }, { resolveHostname: resolvesTo(PUBLIC_ADDRESS), transport });
    expect(result).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
});
