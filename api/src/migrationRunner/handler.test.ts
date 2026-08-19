import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createMigrationRunnerHandler } from './handler.js';
import { runMigrations } from '../db/runMigrations.js';
import type { DbAdminCredentials, MigrationRunnerDeps, MigrationRunnerEvent } from './types.js';

const POSTGRES_IMAGE = 'postgres:16';
const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';
const APP_ROLE = 'parimaan_app';
const TEST_APP_ROLE_PASSWORD = 'handler-test-app-role-password';

const BASELINE_TABLES = [
  'users',
  'households',
  'household_settings',
  'household_memberships',
] as const;

const tableExists = async (client: Client, tableName: string): Promise<boolean> => {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return result.rows[0]?.exists ?? false;
};

const roleExists = async (client: Client, roleName: string): Promise<boolean> => {
  const result = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [roleName]);
  return result.rows.length > 0;
};

const baseEventFields = {
  ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:migration-runner',
  ResponseURL: 'https://example.test/response',
  StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc',
  RequestId: 'request-id',
  LogicalResourceId: 'MigrationRunner',
  ResourceType: 'Custom::MigrationRunner',
  ResourceProperties: { ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:migration-runner' },
};

describe('createMigrationRunnerHandler', () => {
  let container: StartedPostgreSqlContainer;
  let adminClient: Client;
  let deps: MigrationRunnerDeps;
  let runMigrationsSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    adminClient = new Client({ connectionString: container.getConnectionUri() });
    await adminClient.connect();

    const connectionUrl = new URL(container.getConnectionUri());
    const credentials: DbAdminCredentials = {
      username: decodeURIComponent(connectionUrl.username),
      password: decodeURIComponent(connectionUrl.password),
    };

    runMigrationsSpy = vi.fn(runMigrations);

    deps = {
      fetchDbAdminCredentials: async () => credentials,
      fetchAppRolePassword: async () => TEST_APP_ROLE_PASSWORD,
      runMigrations: runMigrationsSpy as unknown as typeof runMigrations,
      dbHost: connectionUrl.hostname,
      dbPort: Number(connectionUrl.port),
      dbName: connectionUrl.pathname.replace(/^\//, ''),
    };
  });

  afterAll(async () => {
    await adminClient.end();
    await container.stop();
  });

  afterEach(() => {
    delete process.env[APP_ROLE_PASSWORD_ENV_VAR];
    runMigrationsSpy.mockClear();
  });

  it('never calls runMigrations on a Delete request, regardless of DB state', async () => {
    const handler = createMigrationRunnerHandler(deps);
    const event: MigrationRunnerEvent = {
      ...baseEventFields,
      RequestType: 'Delete',
      PhysicalResourceId: 'db-migrations:existing',
    };

    await handler(event);

    expect(runMigrationsSpy).not.toHaveBeenCalled();
  });

  it('applies migrations on a Create request: baseline tables and parimaan_app role exist', async () => {
    const handler = createMigrationRunnerHandler(deps);
    const event: MigrationRunnerEvent = {
      ...baseEventFields,
      RequestType: 'Create',
    };

    await handler(event);

    for (const table of BASELINE_TABLES) {
      expect(await tableExists(adminClient, table)).toBe(true);
    }
    expect(await roleExists(adminClient, APP_ROLE)).toBe(true);
  });

  it('behaves the same (idempotently) on an Update request', async () => {
    const handler = createMigrationRunnerHandler(deps);
    const createEvent: MigrationRunnerEvent = {
      ...baseEventFields,
      RequestType: 'Create',
    };
    await handler(createEvent);

    const updateEvent: MigrationRunnerEvent = {
      ...baseEventFields,
      RequestType: 'Update',
      PhysicalResourceId: 'db-migrations:existing',
      OldResourceProperties: baseEventFields.ResourceProperties,
    };

    await expect(handler(updateEvent)).resolves.toBeDefined();

    for (const table of BASELINE_TABLES) {
      expect(await tableExists(adminClient, table)).toBe(true);
    }
    expect(await roleExists(adminClient, APP_ROLE)).toBe(true);
  });

  it('sets PARIMAAN_APP_ROLE_PASSWORD before runMigrations is invoked', async () => {
    const handler = createMigrationRunnerHandler(deps);
    const event: MigrationRunnerEvent = {
      ...baseEventFields,
      RequestType: 'Create',
    };

    expect(process.env[APP_ROLE_PASSWORD_ENV_VAR]).toBeUndefined();

    let observedPassword: string | undefined;
    runMigrationsSpy.mockImplementationOnce(async (...args: Parameters<typeof runMigrations>) => {
      observedPassword = process.env[APP_ROLE_PASSWORD_ENV_VAR];
      return runMigrations(...args);
    });

    await handler(event);

    expect(observedPassword).toBe(TEST_APP_ROLE_PASSWORD);
    expect(process.env[APP_ROLE_PASSWORD_ENV_VAR]).toBe(TEST_APP_ROLE_PASSWORD);
  });
});
