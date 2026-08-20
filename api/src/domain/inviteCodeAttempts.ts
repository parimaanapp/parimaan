import type { PoolClient } from 'pg';
import { isUniqueViolationOnConstraint } from '../db/pgErrors.js';
import { withSavepoint } from '../db/withSavepoint.js';
import { generateInviteCode } from './inviteCode.js';
import type { RandomIntFn } from './inviteCode.js';

/**
 * Total number of invite codes minted before giving up. Against a ~887M-code
 * keyspace (see `inviteCode.ts`) five attempts is astronomically generous —
 * exhausting them means something is wrong beyond bad luck, which is why
 * exhaustion throws rather than silently degrading.
 */
export const MAX_INVITE_CODE_ATTEMPTS = 5;

/** `households.invite_code`'s `UNIQUE` constraint — Postgres's default-generated name. */
const INVITE_CODE_CONSTRAINT = 'households_invite_code_key';

const INVITE_CODE_SAVEPOINT = 'invite_code_attempt';

const isInviteCodeCollision = (error: unknown): boolean =>
  isUniqueViolationOnConstraint(error, INVITE_CODE_CONSTRAINT);

/**
 * Runs `write` with a freshly-generated invite code, retrying with a new code
 * (up to `MAX_INVITE_CODE_ATTEMPTS` attempts in total) whenever the previous
 * attempt collided on `households_invite_code_key`. Any other error
 * propagates immediately — only a genuine invite-code collision is retryable.
 *
 * Each attempt runs inside its own `withSavepoint` scope, because a
 * unique-violation would otherwise abort the entire enclosing transaction and
 * leave nothing to retry into (see `db/withSavepoint.ts`'s own comment for
 * the full rationale).
 *
 * `write` takes the code rather than this helper doing the write itself, so
 * the same retry policy serves both "insert a household with this code"
 * (`createHousehold`) and "update an existing household to this code"
 * (`rotateInviteCode`) — and `invite_code` being `NOT NULL UNIQUE` means
 * neither can be generate-then-null-then-fill.
 */
export const attemptWithFreshInviteCode = async <T>(
  client: PoolClient,
  write: (inviteCode: string) => Promise<T>,
  randomInt?: RandomIntFn,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt += 1) {
    const inviteCode = generateInviteCode(randomInt);
    try {
      return await withSavepoint(client, INVITE_CODE_SAVEPOINT, () => write(inviteCode));
    } catch (error) {
      if (!isInviteCodeCollision(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error(
    `Failed to generate a unique household invite code after ${MAX_INVITE_CODE_ATTEMPTS} attempts.`,
    { cause: lastError },
  );
};
