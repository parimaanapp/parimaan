import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../db/runMigrations.js';

const POSTGRES_IMAGE = 'postgres:16';

/**
 * Same env var / test password the app-role migration
 * (`migrations/1787124517648_app-role.ts`) requires, and the same test-only
 * value `db/migrations.test.ts` already uses — kept here rather than
 * invented fresh, per this repo's established convention (see that file's
 * own comment on why a single shared default matters).
 */
const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';
const APP_ROLE = 'parimaan_app';
const APP_ROLE_TEST_PASSWORD = 'app_role_test_password';

export interface TestDatabase {
  /** Superuser connection URI (Testcontainers default). */
  uri: string;
  /** Connected as the Postgres superuser — bypasses RLS. Use only for setup/teardown, never to assert RLS behavior. */
  adminClient: Client;
  /** Connection URI as the least-privileged `parimaan_app` role — what every repository/resolver test should actually connect as. */
  appUri: string;
  stop: () => Promise<void>;
}

/**
 * Boots a fresh ephemeral `postgres:16` container, migrates it, and returns
 * ready-to-use connections. Every subsequent test (repositories, resolvers)
 * must connect via `appUri` (the `parimaan_app` role), not `adminClient` —
 * a test run as the Postgres superuser bypasses RLS entirely and would prove
 * nothing about the resolver-level + RLS authorization this slice builds.
 */
export const startTestDatabase = async (): Promise<TestDatabase> => {
  process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const uri = container.getConnectionUri();

  await runMigrations(uri, 'up', undefined, [APP_ROLE_TEST_PASSWORD]);

  const adminClient = new Client({ connectionString: uri });
  await adminClient.connect();

  const appUrl = new URL(uri);
  appUrl.username = APP_ROLE;
  appUrl.password = APP_ROLE_TEST_PASSWORD;

  return {
    uri,
    adminClient,
    appUri: appUrl.toString(),
    stop: async (): Promise<void> => {
      await adminClient.end();
      await container.stop();
    },
  };
};

/**
 * Clears every table this test harness knows about between tests within a
 * shared container, via `RESTART IDENTITY CASCADE` — same statement
 * `db/migrations.test.ts` already uses in its `beforeEach` hooks, reused
 * here rather than reinvented. Every migration that adds a new table must
 * add it here too, or a later slice's tests will see leftover rows from an
 * earlier one.
 */
export const truncateAll = async (client: Client): Promise<void> => {
  await client.query(
    'TRUNCATE TABLE pantry_items, household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
  );
};
