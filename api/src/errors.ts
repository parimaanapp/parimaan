/**
 * Base class for all typed, client-safe application errors. `errorType` is a
 * stable string (not the class name, which could be renamed/minified) that
 * clients can branch on. Subclasses below are the vocabulary of typed errors
 * used across the resolvers in this slice — thrown deliberately, never
 * leaking raw internal (e.g. `pg`) error text to the client.
 */
export class AppError extends Error {
  public readonly errorType: string;

  constructor(errorType: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.errorType = errorType;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super('VALIDATION', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super('CONFLICT', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message);
  }
}

/**
 * Thrown when `joinHousehold` would push a household's membership count past
 * `domain/householdLimits.ts`'s `HOUSEHOLD_MEMBER_CAP`. See
 * `repositories/householdRepository.ts`'s `insertMembershipWithinCap` for the
 * concurrency-safe guard that produces this.
 */
export class HouseholdFullError extends AppError {
  constructor(message = 'This household already has the maximum number of members.') {
    super('HOUSEHOLD_FULL', message);
  }
}

/**
 * Thrown by `rateLimit/joinAttemptLimiter.ts` when a caller has exceeded
 * `MAX_JOIN_ATTEMPTS_PER_DAY` — the invite code is a guessable, unrate-limited
 * credential otherwise (see `domain/inviteCode.ts`'s own comment on this).
 */
export class RateLimitedError extends AppError {
  constructor(message = 'Too many join attempts. Try again tomorrow.') {
    super('RATE_LIMITED', message);
  }
}

export interface ClientError {
  errorType: string;
  errorMessage: string;
}

/**
 * Maps any thrown value to a client-safe `{ errorType, errorMessage }` pair.
 * `AppError` instances pass their own type/message through untouched — they
 * were deliberately authored to be client-safe. Anything else (a raw `pg`
 * error, a network failure, a typo'd `throw 'string'`) is collapsed to a
 * generic `INTERNAL` error: its real message may contain connection strings,
 * table names, or other internals that must never reach the client. Detailed
 * context for those belongs in server-side logs, not here.
 */
export const toClientError = (e: unknown): ClientError => {
  if (e instanceof AppError) {
    return { errorType: e.errorType, errorMessage: e.message };
  }
  return { errorType: 'INTERNAL', errorMessage: 'An unexpected error occurred.' };
};
