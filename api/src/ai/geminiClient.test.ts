import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGemini, GeminiAuthError, GeminiTransportError, resetGeminiClientForTesting } from './geminiClient.js';

const config = { geminiApiKeySecretArn: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/gemini-api-key-abc' };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const geminiSuccessBody = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
});

afterEach(() => {
  resetGeminiClientForTesting();
  vi.restoreAllMocks();
});

describe('callGemini', () => {
  it('returns the raw text from a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, geminiSuccessBody('{"title":"Dal"}')));
    const fetchApiKey = vi.fn().mockResolvedValue('test-api-key');

    const result = await callGemini('extract this', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl });

    expect(result.rawText).toBe('{"title":"Dal"}');
  });

  it('sends the API key via the x-goog-api-key header, never a URL query param', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, geminiSuccessBody('{}')));
    const fetchApiKey = vi.fn().mockResolvedValue('super-secret-key');

    await callGemini('prompt', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('super-secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('super-secret-key');
  });

  it('fetches the API key once and caches it across multiple calls', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, geminiSuccessBody('{}')));
    const fetchApiKey = vi.fn().mockResolvedValue('cached-key');

    await callGemini('a', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl });
    await callGemini('b', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl });

    expect(fetchApiKey).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500, 503])('throws GeminiTransportError on HTTP %i', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: 'transient' }));
    const fetchApiKey = vi.fn().mockResolvedValue('key');

    await expect(callGemini('p', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl })).rejects.toBeInstanceOf(
      GeminiTransportError,
    );
  });

  it.each([401, 403])('throws GeminiAuthError on HTTP %i, never retryable', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: 'unauthorized' }));
    const fetchApiKey = vi.fn().mockResolvedValue('key');

    await expect(callGemini('p', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl })).rejects.toBeInstanceOf(
      GeminiAuthError,
    );
  });

  it('throws a plain Error (not GeminiTransportError) on an unexpected non-retryable status like 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'bad request' }));
    const fetchApiKey = vi.fn().mockResolvedValue('key');

    const promise = callGemini('p', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl });
    await expect(promise).rejects.not.toBeInstanceOf(GeminiTransportError);
    await expect(promise).rejects.not.toBeInstanceOf(GeminiAuthError);
  });

  it('throws GeminiTransportError when the fetch itself rejects (network error or abort)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    const fetchApiKey = vi.fn().mockResolvedValue('key');

    await expect(callGemini('p', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl })).rejects.toBeInstanceOf(
      GeminiTransportError,
    );
  });

  it.each([
    { candidates: [] },
    { candidates: [{ content: {} }] },
    { candidates: [{ content: { parts: [] } }] },
    { candidates: [{ content: { parts: [{}] } }] },
  ])('throws on a malformed response shape %#', async (body) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const fetchApiKey = vi.fn().mockResolvedValue('key');

    await expect(callGemini('p', { timeoutMs: 5000 }, { config, fetchApiKey, fetchImpl })).rejects.toThrow();
  });

  it('passes an AbortSignal derived from the given timeoutMs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, geminiSuccessBody('{}')));
    const fetchApiKey = vi.fn().mockResolvedValue('key');

    await callGemini('p', { timeoutMs: 1234 }, { config, fetchApiKey, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
