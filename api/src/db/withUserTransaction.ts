import type { Pool, PoolClient } from 'pg';
import { getPool } from './pool.js';

/**
 * Runs `fn` inside a Postgres transaction that has `parimaan.user_id` set to
 * `userId` for its duration — the RLS-visible identity that
 * `household_settings`'s policy (and any future RLS-protected table)
 * evaluates against. This is the ONLY sanctioned way any repository/resolver
 * in this codebase should acquire a client to touch RLS-protected tables.
 *
 * `SELECT set_config('parimaan.user_id', $1, true)` — the third argument
 * (`true`, "is_local") is load-bearing: it scopes the setting to the current
 * transaction only. With `false` (session-scoped), the setting would persist
 * on the underlying TCP connection after `COMMIT`, and since `pg.Pool`
 * reuses connections across unrelated requests, the NEXT request served by
 * that same pooled connection would inherit the PREVIOUS request's
 * `parimaan.user_id` until it happened to set its own — a cross-tenant RLS
 * bypass window. Transaction-local scoping means the setting evaporates the
 * instant this transaction ends, regardless of how the client is reused
 * afterward.
 *
 * `pool` is injectable for tests (real Testcontainers Postgres, per this
 * repo's convention); defaults to the shared memoized pool.
 */
export const withUserTransaction = async <T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
  pool?: Pool,
): Promise<T> => {
  const resolvedPool = pool ?? (await getPool());
  const client = await resolvedPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (error) {
    // If ROLLBACK itself fails (dropped connection, statement timeout, ...),
    // the client's transaction state is unknown — releasing it plainly would
    // return it to the pool for a future, unrelated request to `BEGIN` on
    // top of, silently nesting inside (or inheriting the aborted state of)
    // this failed transaction. Passing the error to `release()` tells `pg`
    // to destroy the connection instead of pooling it — the only safe move
    // once we can no longer be sure what state it's in.
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch (rollbackError) {
      client.release(rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    }
    throw error;
  }
};
