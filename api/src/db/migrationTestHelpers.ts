import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

/**
 * Real ephemeral Postgres via Testcontainers, per docs/DEV_WORKFLOW.md §3.2:
 * a mocked `pg` client can never exercise RLS, and RLS is defense-in-depth
 * layer 3 (SD §6.2) for this multi-tenant household model. Shared by
 * `migrations.test.ts` and `migrations.recipes.test.ts` — each boots its own
 * `postgres:16` container per describe block, so this is naming, not a
 * shared instance.
 */
export const POSTGRES_IMAGE = 'postgres:16';

export const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';
export const APP_ROLE = 'parimaan_app';
export const APP_ROLE_TEST_PASSWORD = 'app_role_test_password';

export interface InsertedUser {
  id: string;
}

export interface InsertedHousehold {
  id: string;
}

/**
 * `noUncheckedIndexedAccess` means `QueryResult['rows'][0]` types as
 * possibly-`undefined` even though we know a `RETURNING`/`SELECT 1` row is
 * present here. Centralizing the "unwrap or fail loudly" behavior in one
 * helper avoids scattering non-null assertions through every test.
 */
export const firstRow = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Expected at least one row, got none.');
  }
  return row;
};

export const insertUser = async (client: Client): Promise<InsertedUser> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id`,
    [`sub-${randomUUID()}`, `${randomUUID()}@example.test`],
  );
  return { id: firstRow(result.rows).id };
};

export const insertHousehold = async (
  client: Client,
  primaryUserId: string,
  overrides: { subscriptionStatus?: string } = {},
): Promise<InsertedHousehold> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO households (name, invite_code, primary_user_id, subscription_status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      'Test Household',
      `invite-${randomUUID()}`,
      primaryUserId,
      overrides.subscriptionStatus ?? 'free',
    ],
  );
  return { id: firstRow(result.rows).id };
};

export const getColumnTypes = async (
  client: Client,
  tableName: string,
): Promise<Record<string, string>> => {
  const result = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.data_type]));
};

export const tableExists = async (client: Client, tableName: string): Promise<boolean> => {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return firstRow(result.rows).exists;
};
