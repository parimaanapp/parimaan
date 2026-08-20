import type { PoolClient } from 'pg';

/**
 * Runs `fn` inside its own Postgres `SAVEPOINT` — releasing the savepoint on
 * success, and `ROLLBACK TO SAVEPOINT`-ing (then rethrowing the original
 * error) on failure.
 *
 * This exists because a failed statement — most commonly a `23505`
 * unique-violation — aborts the *entire* enclosing Postgres transaction:
 * every subsequent statement fails with "current transaction is aborted"
 * until a `ROLLBACK`. So a naive try/catch around one write inside a
 * `withUserTransaction` scope would poison that whole transaction the moment
 * the first collision happened, taking down every statement that follows it
 * — including reads that have nothing to do with the failed write, and any
 * retry of the write itself. Scoping the attempt to its own
 * `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` pair confines that abort to just the
 * failed attempt, leaving the outer transaction (and everything already
 * written within it) intact for the next attempt or the statements after it.
 *
 * `name` is interpolated straight into the SQL text because savepoint names
 * are *identifiers*, which Postgres does not accept as bind parameters —
 * every caller must therefore pass a hardcoded module-level constant, never
 * anything derived from request input.
 */
export const withSavepoint = async <T>(
  client: PoolClient,
  name: string,
  fn: () => Promise<T>,
): Promise<T> => {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
};
