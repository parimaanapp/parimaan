import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

describe('withErrorHandling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});
