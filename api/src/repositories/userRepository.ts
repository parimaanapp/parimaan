import type { PoolClient } from 'pg';
import type { CallerIdentity } from '../auth/identity.js';
import { ConflictError } from '../errors.js';
import { isUniqueViolationOnConstraint } from '../db/pgErrors.js';

export interface UserRow {
  id: string;
  cognitoSub: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

interface RawUserRow {
  id: string;
  cognito_sub: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
}

const mapRow = (row: RawUserRow): UserRow => ({
  id: row.id,
  cognitoSub: row.cognito_sub,
  email: row.email,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  createdAt: row.created_at,
});

const USERS_EMAIL_KEY_CONSTRAINT = 'users_email_key';

/**
 * Inserts a `users` row on first login for a given Cognito sub, or updates
 * one on every subsequent login. `email` is always overwritten with the
 * latest claim value (Cognito is the source of truth for it), but
 * `display_name`/`avatar_url` use `COALESCE(EXCLUDED.x, users.x)` rather
 * than a bare overwrite — some identity providers (e.g. Google, for some
 * accounts) omit `name`/`picture` on a given login, and a bare overwrite
 * would null out previously-good data the user already had stored.
 *
 * A same-email-different-sub conflict (re-signup under a new Cognito
 * identity but the same email) is rejected as a `ConflictError` rather than
 * silently relinking accounts — a known MVP limitation, not a bug.
 */
export const upsertUserByCognitoSub = async (
  client: PoolClient,
  input: CallerIdentity,
): Promise<UserRow> => {
  try {
    const result = await client.query<RawUserRow>(
      `INSERT INTO users (cognito_sub, email, display_name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cognito_sub) DO UPDATE
         SET email = EXCLUDED.email,
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
       RETURNING *`,
      [input.cognitoSub, input.email, input.displayName, input.avatarUrl],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('upsertUserByCognitoSub: expected a returned row.');
    }
    return mapRow(row);
  } catch (error) {
    if (isUniqueViolationOnConstraint(error, USERS_EMAIL_KEY_CONSTRAINT)) {
      throw new ConflictError(
        'An account with this email already exists under a different sign-in identity.',
      );
    }
    throw error;
  }
};

export const findUserByCognitoSub = async (
  client: PoolClient,
  cognitoSub: string,
): Promise<UserRow | null> => {
  const result = await client.query<RawUserRow>(`SELECT * FROM users WHERE cognito_sub = $1`, [
    cognitoSub,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : mapRow(row);
};
