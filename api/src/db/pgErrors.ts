/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

/**
 * Narrows an `unknown` caught error to "this is a Postgres unique-violation
 * on the given constraint name." Shared by every repository/resolver that
 * needs to distinguish a specific expected collision (e.g. a duplicate
 * email, a colliding invite code) from any other failure, which must
 * propagate unhandled.
 */
export const isUniqueViolationOnConstraint = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === UNIQUE_VIOLATION &&
  'constraint' in error &&
  (error as { constraint: unknown }).constraint === constraint;
