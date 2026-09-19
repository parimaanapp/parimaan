import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiBusyError, AiTimeoutError, AiUnavailableError, AiUnparseableError } from '../errors.js';
import { resetGeminiClientForTesting } from './geminiClient.js';
import { invokeModel } from './invokeModel.js';

const config = { geminiApiKeySecretArn: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/gemini-api-key-abc' };
const fetchApiKey = () => Promise.resolve('test-key');
/** No-op — the real ~500ms/~1.5s backoff windows are production behaviour, not something a unit test should actually wait out. */
const sleepImpl = () => Promise.resolve();
/** No-op — real emission (`costMetric.test.ts`) and the real cost-math wiring (below) are tested separately; this suite's own job is the retry/deadline/parse contract, not metering noise on every test's stdout. */
const emitCostMetric = () => undefined;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const geminiSuccessBody = (text: string, usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number }) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  ...(usageMetadata ? { usageMetadata } : {}),
});

const schema = z.object({ title: z.string(), count: z.number() });

afterEach(() => {
  resetGeminiClientForTesting();
  vi.restoreAllMocks();
});

describe('invokeModel — transport chain', () => {
  it('429 then 429 then success returns the parsed value', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":2}')));

    const result = await invokeModel(
      'prompt',
      schema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric, sleepImpl },
    );

    expect(result).toEqual({ title: 'Dal', count: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('three consecutive 429s exhausts the transport chain and throws AiBusyError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'busy' }));

    await expect(
      invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric, sleepImpl }),
    ).rejects.toBeInstanceOf(AiBusyError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])(
    'HTTP %i throws AiUnavailableError immediately, with no retry and no internals in the message',
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: 'unauthorized' }));

      const promise = invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric });
      await expect(promise).rejects.toBeInstanceOf(AiUnavailableError);
      await expect(promise).rejects.not.toThrow(/aws|secret|arn|credential/i);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('an unexpected, non-typed failure (e.g. a malformed response shape) maps to AiUnavailableError immediately, not a wasted retry, and preserves the original cause', async () => {
    // A response with no `candidates` — `extractTextFromGeminiResponse`
    // throws a plain Error for this, not GeminiTransportError/GeminiAuthError.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { candidates: [] }));

    let caught: unknown;
    try {
      await invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((caught as AiUnavailableError).cause).toBeInstanceOf(Error);
    expect(((caught as AiUnavailableError).cause as Error).message).toMatch(/no candidates/);
  });
});

describe('invokeModel — output chain', () => {
  it('non-JSON first response triggers a reinforced retry that succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('not json at all')))
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":2}')));

    const result = await invokeModel(
      'prompt',
      schema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric },
    );

    expect(result).toEqual({ title: 'Dal', count: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(secondCallBody.contents[0]!.parts[0]!.text).toContain('Return valid JSON only');
  });

  it('two bad responses in a row throws AiUnparseableError, preserving the parse failure as cause', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, geminiSuccessBody('not json at all')));

    let caught: unknown;
    try {
      await invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AiUnparseableError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((caught as AiUnparseableError).cause).toBeInstanceOf(Error);
  });

  it('raw model output over the size cap is rejected as a parse failure before JSON.parse ever runs on it', async () => {
    const hugeText = `{"title":"${'x'.repeat(250_000)}","count":2}`;
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, geminiSuccessBody(hugeText)));

    await expect(
      invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric }),
    ).rejects.toBeInstanceOf(AiUnparseableError);
    // Hits the reinforcement retry too, same as any other parse failure —
    // the cap doesn't special-case itself out of the normal output chain.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a schema structural violation (wrong type) also triggers the reinforcement retry, not a silent pass-through', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":"two"}')))
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":2}')));

    const result = await invokeModel(
      'prompt',
      schema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric },
    );

    expect(result).toEqual({ title: 'Dal', count: 2 });
  });

  it('markdown-fenced JSON (```json ... ```) is stripped and accepted, not treated as a failure', async () => {
    const fenced = '```json\n{"title":"Dal","count":2}\n```';
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody(fenced)));

    const result = await invokeModel(
      'prompt',
      schema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric },
    );

    expect(result).toEqual({ title: 'Dal', count: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a bare ``` fence (no "json" language tag) is also stripped and accepted', async () => {
    const fenced = '```\n{"title":"Dal","count":2}\n```';
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody(fenced)));

    const result = await invokeModel(
      'prompt',
      schema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric },
    );

    expect(result).toEqual({ title: 'Dal', count: 2 });
  });

  it('bounds violations (e.g. an array far past a schema cap) are rejected, not forwarded', async () => {
    const boundedSchema = z.object({ ingredients: z.array(z.string()).max(100) });
    const tooMany = Array.from({ length: 10_000 }, (_, i) => `ingredient ${i}`);
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonResponse(200, geminiSuccessBody(JSON.stringify({ ingredients: tooMany }))));

    await expect(
      invokeModel('prompt', boundedSchema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric }),
    ).rejects.toBeInstanceOf(AiUnparseableError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("enum leniency is entirely the caller's schema design — .catch() on one field lets the parse succeed with a fallback, no reinforcement retry needed", async () => {
    const lenientSchema = z.object({
      title: z.string(),
      cuisineTier1: z.enum(['north_indian', 'south_indian']).nullable().catch(null),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('{"title":"Dal","cuisineTier1":"punjabi"}')));

    const result = await invokeModel(
      'prompt',
      lenientSchema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric },
    );

    expect(result).toEqual({ title: 'Dal', cuisineTier1: null });
    // No reinforcement retry — the .catch() resolved it on the first attempt.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('invokeModel — deadline', () => {
  it('a slow first attempt that leaves insufficient budget for a retry throws AiTimeoutError, not a retry', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    // A deadline shorter than even one real attempt's backoff window —
    // the very first attempt already exhausts the budget.
    await expect(
      invokeModel('prompt', schema, { deadlineMs: 1 }, { config, fetchApiKey, fetchImpl, emitCostMetric }),
    ).rejects.toBeInstanceOf(AiTimeoutError);
  });
});

// W19 D6 — unlike every other describe block above (which inject the
// module-scope no-op `emitCostMetric` to keep this suite's own output
// clean), these tests inject a real spy to prove the wiring itself: a
// successful call really does compute real cost from real usage and really
// does call the injected emitter with it.
describe('invokeModel — cost-metric emission (W19 D6)', () => {
  it('emits the real computed cost for a successful first attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":2}', { promptTokenCount: 1000, candidatesTokenCount: 100 })),
      );
    const emitSpy = vi.fn();

    await invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric: emitSpy });

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(1000 * (0.3 / 1_000_000) + 100 * (2.5 / 1_000_000));
  });

  it('emits once per real underlying Gemini call — a reinforcement retry is a real second call with real second cost', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('not json', { promptTokenCount: 500, candidatesTokenCount: 10 })))
      .mockResolvedValueOnce(
        jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":2}', { promptTokenCount: 520, candidatesTokenCount: 20 })),
      );
    const emitSpy = vi.fn();

    await invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, sleepImpl, emitCostMetric: emitSpy });

    expect(emitSpy).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenNthCalledWith(1, 500 * (0.3 / 1_000_000) + 10 * (2.5 / 1_000_000));
    expect(emitSpy).toHaveBeenNthCalledWith(2, 520 * (0.3 / 1_000_000) + 20 * (2.5 / 1_000_000));
  });

  it('a metering emitter that throws never breaks an otherwise-successful call', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, geminiSuccessBody('{"title":"Dal","count":2}')));
    const throwingEmit = vi.fn(() => {
      throw new Error('metering backend down');
    });

    const result = await invokeModel(
      'prompt',
      schema,
      { deadlineMs: 30_000 },
      { config, fetchApiKey, fetchImpl, emitCostMetric: throwingEmit },
    );

    expect(result).toEqual({ title: 'Dal', count: 2 });
  });
});
