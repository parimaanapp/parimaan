/**
 * Base class for all typed, client-safe application errors. `errorType` is a
 * stable string (not the class name, which could be renamed/minified) that
 * clients can branch on. Subclasses below are the vocabulary of typed errors
 * used across the resolvers in this slice — thrown deliberately, never
 * leaking raw internal (e.g. `pg`) error text to the client.
 */
export class AppError extends Error {
  public readonly errorType: string;

  /**
   * `cause` is optional and, per `Error`'s own contract, never included in
   * `toClientError`'s output below — it exists so a resolver can preserve
   * the *original* failure (e.g. a specific Gemini/network error) for
   * server-side logging (`resolvers/withErrorHandling.ts`'s own documented
   * "log the unredacted error" contract) while still throwing a client-safe
   * replacement. Losing this was a real gap: `ai/invokeModel.ts` used to
   * construct every `Ai*Error` with no arguments at all, so the actual
   * cause of an `AI_UNAVAILABLE` (a safety-filtered response? a changed
   * response shape? a genuine outage?) was indistinguishable in CloudWatch.
   */
  constructor(errorType: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
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

/**
 * Thrown by `ai/invokeModel.ts` when the transport retry chain (up to 2
 * retries against 429/503/500/connection errors) is exhausted. Retryable by
 * the user — the mobile client offers an inline retry, the pasted text is
 * never lost (W7 §13.2.7).
 */
export class AiBusyError extends AppError {
  constructor(message = 'The AI service is busy. Try again in a moment.', options?: { cause?: unknown }) {
    super('AI_BUSY', message, options);
  }
}

/**
 * Thrown when the output retry chain (exactly 1 reinforcement retry against
 * a JSON.parse failure or a structural/bounds Zod failure — never an
 * enum-only failure, see `D4`/§13.2.5) is exhausted. Not retryable by the
 * user; routes to the AI failure fallback screen (12.1).
 */
export class AiUnparseableError extends AppError {
  constructor(message = 'Could not understand the AI response.', options?: { cause?: unknown }) {
    super('AI_UNPARSEABLE', message, options);
  }
}

/**
 * Thrown when the provider rejects the credential or the request outright
 * (HTTP 401/403, revoked key, retired model, account-level quota
 * exhausted) — never retried, since retrying an auth failure just repeats
 * it. Routes to the fallback screen with distinct copy from `AiBusyError`.
 */
export class AiUnavailableError extends AppError {
  constructor(message = 'The AI service is unavailable right now.', options?: { cause?: unknown }) {
    super('AI_UNAVAILABLE', message, options);
  }
}

/**
 * Thrown when `invokeModel`'s shared deadline (`AI_DEADLINE_MS`, §13.2.7) is
 * reached with no usable response — a slow first attempt that leaves
 * insufficient budget does not start a retry, it throws this directly.
 * Retryable by the user (a fresh call gets a fresh deadline).
 */
export class AiTimeoutError extends AppError {
  constructor(message = 'The AI service took too long to respond.', options?: { cause?: unknown }) {
    super('AI_TIMEOUT', message, options);
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
