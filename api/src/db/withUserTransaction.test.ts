import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';
import { withUserTransaction } from './withUserTransaction.js';

/**
 * Real ephemeral Postgres via Testcontainers, per this repo's established
 * convention (see `db/migrations.test.ts`) — a mocked `pg` client can never
 * exercise `set_config`/transaction-local session-variable semantics, which
 * is the entire point of this file. One container for the whole describe
 * block; each test truncates first.
 */
const POSTGRES_IMAGE = 'postgres:16';
const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';

const insertUser = async (pool: Pool): Promise<string> => {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id`,
    [`sub-${randomUUID()}`, `${randomUUID()}@example.test`],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('Expected an inserted user row.');
  }
  return row.id;
};

describe('withUserTransaction', () => {
  let container: StartedPostgreSqlContainer;
  // max: 1 forces every acquisition to reuse the same underlying connection —
  // this is load-bearing for the cross-tenant-leak regression test below,
  // which specifically checks that a *pooled connection reused by a
  // different user after COMMIT* doesn't still carry the previous request's
  // RLS scope.
  let pool: Pool;
  // `pool` connects as the Testcontainers default (Postgres superuser),
  // which bypasses RLS entirely — fine for the set_config leak-regression
  // test (pure session-variable behavior, unrelated to RLS), but useless for
  // proving an unauthenticated raw query against an RLS-protected table
  // fails. `appPool` connects as the actual `parimaan_app` least-privileged
  // role, which the app-role migration (PR #9) has evaluate RLS for real.
  let appPool: Pool;

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = 'app_role_test_password';
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });

    const appUri = new URL(container.getConnectionUri());
    appUri.username = 'parimaan_app';
    appUri.password = 'app_role_test_password';
    appPool = new Pool({ connectionString: appUri.toString(), max: 1 });
  });

  afterAll(async () => {
    await pool.end();
    await appPool.end();
    await container.stop();
  });

  afterEach(async () => {
    await pool.query(
      'TRUNCATE TABLE household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
    );
  });

  it('makes parimaan.user_id visible inside the callback', async () => {
    const userId = await insertUser(pool);
    const observed = await withUserTransaction(
      userId,
      async (client) => {
        const result = await client.query<{ value: string }>(
          `SELECT current_setting('parimaan.user_id') AS value`,
        );
        return result.rows[0]?.value;
      },
      pool,
    );
    expect(observed).toBe(userId);
  });

  it('does NOT leave parimaan.user_id set on a later transaction reusing the same pooled connection (cross-tenant-leak regression)', async () => {
    const userA = await insertUser(pool);

    await withUserTransaction(
      userA,
      async (client) => {
        await client.query(`SELECT current_setting('parimaan.user_id')`);
      },
      pool,
    );

    // A brand-new transaction, on the (necessarily, since max: 1) same
    // underlying connection, that never calls withUserTransaction itself.
    //
    // Note: once a custom ("dotted-namespace") GUC like `parimaan.user_id`
    // has been referenced at all on a backend connection, Postgres registers
    // a session-lifetime placeholder for it — so after that first reference,
    // an unset custom GUC reads back as `''` rather than raising
    // "unrecognized configuration parameter" (that error only fires the
    // very first time a never-before-seen custom GUC name is queried on a
    // connection). Since this connection already referenced
    // `parimaan.user_id` inside the `withUserTransaction` call above, the
    // regression this test actually guards against is: does the *value* leak
    // across to a new transaction on the same connection? It must not — it
    // must never read back as `userA`, whether that manifests as `''` or as
    // a thrown error.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let leaked: string | undefined;
      try {
        const result = await client.query<{ current_setting: string }>(
          `SELECT current_setting('parimaan.user_id')`,
        );
        leaked = result.rows[0]?.current_setting;
      } catch {
        leaked = undefined;
      }
      expect(leaked).not.toBe(userA);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rolls back an INSERT when the callback throws', async () => {
    const userId = await insertUser(pool);

    await expect(
      withUserTransaction(
        userId,
        async (client) => {
          await client.query(
            `INSERT INTO households (name, invite_code, primary_user_id) VALUES ($1, $2, $3)`,
            ['Rollback Household', `invite-${randomUUID()}`, userId],
          );
          throw new Error('boom');
        },
        pool,
      ),
    ).rejects.toThrow('boom');

    const result = await pool.query('SELECT 1 FROM households');
    expect(result.rows).toHaveLength(0);
  });

  it('releases the client back to the pool even when the callback throws', async () => {
    const userId = await insertUser(pool);

    await expect(
      withUserTransaction(
        userId,
        async () => {
          throw new Error('boom');
        },
        pool,
      ),
    ).rejects.toThrow('boom');

    expect(pool.idleCount).toBe(1);
    expect(pool.waitingCount).toBe(0);
  });

  it('raw query against household_settings outside this wrapper throws unrecognized configuration parameter', async () => {
    await expect(
      appPool.query(`SELECT * FROM household_settings`),
    ).rejects.toThrow(/unrecognized configuration parameter/);
  });
});
