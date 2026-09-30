import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { invokeModel } from '../ai/invokeModel.js';
import { resetGeminiClientForTesting } from '../ai/geminiClient.js';
import { UnauthorizedError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const geminiSuccessBody = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe('withErrorHandling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetGeminiClientForTesting();
  });

  it('passes the result through untouched on success', async () => {
    const wrapped = withErrorHandling(async (event: number) => event * 2);
    await expect(wrapped(21)).resolves.toBe(42);
  });

  it('preserves a known AppError\'s errorType and message', async () => {
    const wrapped = withErrorHandling(async () => {
      throw new UnauthorizedError('nope');
    });
    await expect(wrapped(undefined)).rejects.toMatchObject({
      message: 'nope',
      errorType: 'UNAUTHORIZED',
    });
  });

  it('collapses an unrecognized error to the generic INTERNAL type, dropping the original message', async () => {
    const wrapped = withErrorHandling(async () => {
      throw new Error(
        'Secret arn:aws:secretsmanager:ap-south-1:123456789012:secret:app-role does not have the expected shape.',
      );
    });
    const rejection = wrapped(undefined);
    await expect(rejection).rejects.toMatchObject({ errorType: 'INTERNAL' });
    await expect(rejection).rejects.not.toThrow(/secretsmanager|123456789012/);
  });

  it('logs the original, unredacted error server-side before throwing the sanitized replacement', async () => {
    const original = new Error('raw pg error: relation "users" does not exist');
    const wrapped = withErrorHandling(async () => {
      throw original;
    });
    await expect(wrapped(undefined)).rejects.toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith('Resolver error:', original);
  });

  it('still rejects with a typed error for a second known AppError subclass (ValidationError)', async () => {
    const wrapped = withErrorHandling(async () => {
      throw new ValidationError('name is required');
    });
    await expect(wrapped(undefined)).rejects.toMatchObject({
      message: 'name is required',
      errorType: 'VALIDATION',
    });
  });

  it(
    "sets the thrown error's `name` to the client errorType, not just an inert `errorType` " +
      'own-property — AppSync Direct Lambda Resolvers (no VTL in front, see api-stack.ts) read ' +
      "a thrown error's wire-level `errorType` sibling from the Lambda runtime's own invocation-" +
      "error envelope, which Node derives from `Error.prototype.name` (defaulting to the generic " +
      "string \"Error\" for a plain `new Error(...)`), never from an arbitrary same-named own " +
      'property. Before this test, every typed error this API throws was silently downgraded to ' +
      "a generic \"Error\"/INTERNAL classification on the wire — invisible in unit tests (which " +
      'never go through real Lambda/AppSync serialization) but breaking any client logic that ' +
      'branches on a specific errorType (e.g. `ConflictError` triggering a client-side redirect).',
    async () => {
      const wrapped = withErrorHandling(async () => {
        throw new ValidationError('name is required');
      });
      await expect(wrapped(undefined)).rejects.toMatchObject({
        name: 'VALIDATION',
      });
    },
  );

  it("never logs a snippet of the model's raw output for an AI_UNPARSEABLE failure — household content (pantry items, staples) must never reach CloudWatch (SD §8.3, E2E_MVP_PLAN.md W21 D11)", async () => {
    const householdContent = 'Basmati Rice, Toor Dal, and Amul Butter are on the shelf';
    const schema = z.object({ title: z.string(), count: z.number() });
    const config = {
      geminiApiKeySecretArn: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/gemini-api-key-abc',
    };
    const fetchApiKey = () => Promise.resolve('test-key');
    const emitCostMetric = () => undefined;
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, geminiSuccessBody(householdContent)));

    const wrapped = withErrorHandling(async () =>
      invokeModel('prompt', schema, { deadlineMs: 30_000 }, { config, fetchApiKey, fetchImpl, emitCostMetric }),
    );

    await expect(wrapped(undefined)).rejects.toMatchObject({ errorType: 'AI_UNPARSEABLE' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = errorSpy.mock.calls[0]!;
    // Simulate how Node actually renders this call (console.error uses
    // util.inspect under the hood, which recursively prints an Error's
    // `cause` chain) — the household content must not survive that.
    const { inspect } = await import('node:util');
    const renderedLog = loggedArgs.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: null }))).join(' ');
    expect(renderedLog).not.toContain('Basmati');
    expect(renderedLog).not.toContain(householdContent);
  });
});
