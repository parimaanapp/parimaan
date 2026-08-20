import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from './withUserTransaction.js';
import { withSavepoint } from './withSavepoint.js';

describe('withSavepoint', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const insertUser = (client: PoolClient, cognitoSub: string): Promise<unknown> =>
    client.query(`INSERT INTO users (cognito_sub, email) VALUES ($1, $2)`, [
      cognitoSub,
      `${cognitoSub}@example.test`,
    ]);

  it('returns fn\'s value and releases the savepoint on success', async () => {
    const actorId = randomUUID();
    const result = await withUserTransaction(
      actorId,
      (client) => withSavepoint(client, 'success_case', async () => 'ok'),
      pool,
    );
    expect(result).toBe('ok');
  });

  it('does NOT poison the outer transaction when the inner statement raises a 23505', async () => {
    // The whole reason this helper exists: without the SAVEPOINT, the
    // unique-violation below would abort the enclosing transaction, and the
    // *second* insert would fail with "current transaction is aborted"
    // rather than succeeding.
    const taken = `sub-taken-${randomUUID()}`;
    const fresh = `sub-fresh-${randomUUID()}`;

    await withUserTransaction(randomUUID(), (client) => insertUser(client, taken), pool);

    await withUserTransaction(
      randomUUID(),
      async (client) => {
        await expect(
          withSavepoint(client, 'collision_case', () => insertUser(client, taken)),
        ).rejects.toMatchObject({ code: '23505' });

        // Same outer transaction, after the failed attempt — this is the
        // statement that would blow up without the savepoint.
        await insertUser(client, fresh);
      },
      pool,
    );

    const rows = await pool.query('SELECT cognito_sub FROM users ORDER BY cognito_sub');
    expect(rows.rows.map((r) => r.cognito_sub as string).sort()).toEqual([taken, fresh].sort());
  });

  it('rethrows the original error unchanged after rolling back', async () => {
    const sentinel = new Error('forced failure inside the savepoint');
    await expect(
      withUserTransaction(
        randomUUID(),
        (client) =>
          withSavepoint(client, 'rethrow_case', () => {
            throw sentinel;
          }),
        pool,
      ),
    ).rejects.toBe(sentinel);
  });

  it('rolls back only the failed attempt — writes made before it in the same transaction survive the commit', async () => {
    const kept = `sub-kept-${randomUUID()}`;
    const discarded = `sub-discarded-${randomUUID()}`;

    await withUserTransaction(
      randomUUID(),
      async (client) => {
        await insertUser(client, kept);
        await expect(
          withSavepoint(client, 'partial_case', async () => {
            await insertUser(client, discarded);
            throw new Error('abandon this attempt');
          }),
        ).rejects.toThrow('abandon this attempt');
      },
      pool,
    );

    const rows = await pool.query('SELECT cognito_sub FROM users');
    expect(rows.rows.map((r) => r.cognito_sub as string)).toEqual([kept]);
  });
});
