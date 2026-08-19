import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  toClientError,
} from './errors.js';

describe('AppError subclasses', () => {
  it('UnauthorizedError carries errorType UNAUTHORIZED', () => {
    const error = new UnauthorizedError('nope');
    expect(error).toBeInstanceOf(AppError);
    expect(error.errorType).toBe('UNAUTHORIZED');
    expect(error.message).toBe('nope');
  });

  it('ForbiddenError carries errorType FORBIDDEN', () => {
    const error = new ForbiddenError('nope');
    expect(error.errorType).toBe('FORBIDDEN');
  });

  it('ValidationError carries errorType VALIDATION', () => {
    const error = new ValidationError('bad input');
    expect(error.errorType).toBe('VALIDATION');
  });

  it('ConflictError carries errorType CONFLICT', () => {
    const error = new ConflictError('already exists');
    expect(error.errorType).toBe('CONFLICT');
  });

  it('NotFoundError carries errorType NOT_FOUND', () => {
    const error = new NotFoundError('missing');
    expect(error.errorType).toBe('NOT_FOUND');
  });
});

describe('toClientError', () => {
  it('passes through an AppError\'s errorType and message', () => {
    const result = toClientError(new ConflictError('email already in use'));
    expect(result).toEqual({ errorType: 'CONFLICT', errorMessage: 'email already in use' });
  });

  it('returns a generic message for a raw Error, never leaking its internal message', () => {
    const raw = new Error('password authentication failed for user "parimaan_app"');
    const result = toClientError(raw);
    expect(result.errorType).toBe('INTERNAL');
    expect(result.errorMessage).not.toMatch(/password|parimaan_app/i);
  });

  it('returns a generic message for a non-Error thrown value', () => {
    const result = toClientError('some string thrown');
    expect(result.errorType).toBe('INTERNAL');
    expect(result.errorMessage).not.toMatch(/some string thrown/);
  });
});
