import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';

/**
 * Real ephemeral Postgres via Testcontainers, per docs/DEV_WORKFLOW.md §3.2:
 * a mocked `pg` client can never exercise RLS, and RLS is defense-in-depth
 * layer 3 (SD §6.2) for this multi-tenant household model. Every describe
 * block below boots its own `postgres:16` container so each is a genuinely
 * fresh database — slower than mocks, intentionally so.
 */
const POSTGRES_IMAGE = 'postgres:16';

const BASELINE_TABLES = [
  'users',
  'households',
  'household_settings',
  'household_memberships',
] as const;

const VALID_SUBSCRIPTION_STATUSES = ['free', 'trial', 'active', 'past_due', 'cancelled'] as const;

const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';
const APP_ROLE = 'parimaan_app';
const APP_ROLE_TEST_PASSWORD = 'app_role_test_password';

/**
 * The app-role migration (`migrations/1787124517648_app-role.ts`) requires
 * `PARIMAAN_APP_ROLE_PASSWORD` to be set at migration-run time, and it's now
 * part of the full migration set `runMigrations()` applies — so every
 * describe block in this file that runs migrations ends up running it, not
 * just the ones below that specifically test it. A default test-only value
 * is set once here, at module load (before any test runs), so unrelated
 * describe blocks aren't affected. The "without PARIMAAN_APP_ROLE_PASSWORD
 * set" block below temporarily unsets it and restores this same default
 * afterward.
 */
process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;

interface InsertedUser {
  id: string;
}

interface InsertedHousehold {
  id: string;
}

/**
 * `noUncheckedIndexedAccess` means `QueryResult['rows'][0]` types as
 * possibly-`undefined` even though we know a `RETURNING`/`SELECT 1` row is
 * present here. Centralizing the "unwrap or fail loudly" behavior in one
 * helper avoids scattering non-null assertions through every test.
 */
const firstRow = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Expected at least one row, got none.');
  }
  return row;
};

const insertUser = async (client: Client): Promise<InsertedUser> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id`,
    [`sub-${randomUUID()}`, `${randomUUID()}@example.test`],
  );
  return { id: firstRow(result.rows).id };
};

const insertHousehold = async (
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

const getColumnTypes = async (
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

const tableExists = async (client: Client, tableName: string): Promise<boolean> => {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return firstRow(result.rows).exists;
};

describe('running the baseline-schema migration', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it('runs against a fresh database without throwing', async () => {
    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();
  });

  it('records the migration as applied in the pgmigrations tracking table', async () => {
    const result = await client.query('SELECT name FROM pgmigrations');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.some((row: { name: string }) => row.name.includes('baseline-schema'))).toBe(
      true,
    );
  });
});

describe('baseline schema, once migrated', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  /**
   * A dedicated, non-superuser, non-table-owning login role used only for
   * the RLS test below. This is load-bearing, not incidental: Testcontainers'
   * `PostgreSqlContainer` connects as the Postgres role created from
   * `POSTGRES_USER`, which the official postgres image makes the cluster's
   * superuser — and Postgres RLS is silently skipped for superusers *and*
   * for the owner of the table (unless the table has `FORCE ROW LEVEL
   * SECURITY`, which this schema does not set). Running the RLS assertions
   * as `client` would therefore pass even if the policy were completely
   * broken. `rlsProbeRole` is granted only SELECT/INSERT on the two tables
   * it needs, so the policy is actually evaluated.
   */
  const rlsProbeRole = 'rls_probe_role';
  const rlsProbePassword = 'rls_probe_password';

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD '${rlsProbePassword}'`);
    await client.query(
      `GRANT SELECT, INSERT ON household_settings, household_memberships TO ${rlsProbeRole}`,
    );
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  beforeEach(async () => {
    // Isolate each `it()` from the last without paying for a fresh container
    // per test — RESTART IDENTITY CASCADE also clears household_settings/
    // household_memberships via the FK cascade.
    await client.query(
      'TRUNCATE TABLE household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
    );
  });

  const connectAsRlsProbe = async (userId: string): Promise<Client> => {
    const uri = new URL(container.getConnectionUri());
    uri.username = rlsProbeRole;
    uri.password = rlsProbePassword;
    const probeClient = new Client({ connectionString: uri.toString() });
    await probeClient.connect();
    await probeClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [userId]);
    return probeClient;
  };

  it('creates all four baseline tables', async () => {
    for (const table of BASELINE_TABLES) {
      expect(await tableExists(client, table)).toBe(true);
    }
  });

  it('creates the users table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'users');
    expect(columns).toMatchObject({
      id: 'uuid',
      cognito_sub: 'text',
      email: 'text',
      display_name: 'text',
      avatar_url: 'text',
      created_at: 'timestamp with time zone',
    });
  });

  it('creates the households table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'households');
    expect(columns).toMatchObject({
      id: 'uuid',
      name: 'text',
      invite_code: 'text',
      primary_user_id: 'uuid',
      subscription_status: 'text',
      plan_id: 'text',
      stripe_customer_id: 'text',
      created_at: 'timestamp with time zone',
    });
  });

  it('creates the household_settings table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'household_settings');
    expect(columns).toMatchObject({
      household_id: 'uuid',
      meals_enabled: 'jsonb',
      meal_structure: 'jsonb',
      cuisine_tier1: 'jsonb',
      cuisine_tier2_weights: 'jsonb',
      dietary_tags: 'jsonb',
      allergens: 'jsonb',
      skip_ingredients: 'jsonb',
      updated_at: 'timestamp with time zone',
    });
  });

  it('creates the household_memberships table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'household_memberships');
    expect(columns).toMatchObject({
      id: 'uuid',
      household_id: 'uuid',
      user_id: 'uuid',
      role: 'text',
      joined_at: 'timestamp with time zone',
    });
  });

  it('rejects a household referencing a non-existent primary_user_id', async () => {
    await expect(
      client.query(
        `INSERT INTO households (name, invite_code, primary_user_id) VALUES ($1, $2, $3)`,
        ['Orphan Household', `invite-${randomUUID()}`, randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('rejects a household_membership referencing a non-existent household_id', async () => {
    const user = await insertUser(client);
    await expect(
      client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [randomUUID(), user.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects a household_membership referencing a non-existent user_id', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await expect(
      client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [household.id, randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid households.subscription_status', async () => {
    const owner = await insertUser(client);
    await expect(insertHousehold(client, owner.id, { subscriptionStatus: 'not_a_status' })).rejects
      .toThrow();
  });

  it.each(VALID_SUBSCRIPTION_STATUSES)(
    'accepts households.subscription_status = %s',
    async (subscriptionStatus) => {
      const owner = await insertUser(client);
      await expect(
        insertHousehold(client, owner.id, { subscriptionStatus }),
      ).resolves.toMatchObject({ id: expect.any(String) });
    },
  );

  it('rejects an invalid household_memberships.role', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await expect(
      client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [household.id, owner.id],
      ),
    ).rejects.toThrow();
  });

  it.each(['primary', 'member'] as const)(
    'accepts household_memberships.role = %s',
    async (role) => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      await expect(
        client.query(
          `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, $3)`,
          [household.id, owner.id, role],
        ),
      ).resolves.toBeDefined();
    },
  );

  it('rejects a duplicate (household_id, user_id) membership', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [household.id, owner.id],
    );
    await expect(
      client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [household.id, owner.id],
      ),
    ).rejects.toThrow();
  });

  it('cascades household deletion to household_settings and household_memberships', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await client.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
      household.id,
    ]);
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [household.id, owner.id],
    );

    await client.query(`DELETE FROM households WHERE id = $1`, [household.id]);

    const settings = await client.query(
      `SELECT 1 FROM household_settings WHERE household_id = $1`,
      [household.id],
    );
    const memberships = await client.query(
      `SELECT 1 FROM household_memberships WHERE household_id = $1`,
      [household.id],
    );
    expect(settings.rows).toHaveLength(0);
    expect(memberships.rows).toHaveLength(0);
  });

  it('defaults household_settings.meals_enabled when not specified on insert', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await client.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
      household.id,
    ]);

    const result = await client.query<{ meals_enabled: string[] }>(
      `SELECT meals_enabled FROM household_settings WHERE household_id = $1`,
      [household.id],
    );
    expect(firstRow(result.rows).meals_enabled).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('denies a non-member from reading another household\'s settings via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await client.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
      householdA.id,
    ]);
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdA.id, ownerA.id],
    );
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdB.id, ownerB.id],
    );

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(
        `SELECT * FROM household_settings WHERE household_id = $1`,
        [householdA.id],
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await asOutsider.end();
    }
  });

  it('allows a household member to read their own household settings via RLS', async () => {
    const ownerA = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    await client.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
      householdA.id,
    ]);
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdA.id, ownerA.id],
    );

    const asMember = await connectAsRlsProbe(ownerA.id);
    try {
      const result = await asMember.query(
        `SELECT household_id FROM household_settings WHERE household_id = $1`,
        [householdA.id],
      );
      expect(result.rows).toHaveLength(1);
      expect(firstRow(result.rows).household_id).toBe(householdA.id);
    } finally {
      await asMember.end();
    }
  });
});

describe('running the app-role migration', () => {
  describe('without PARIMAAN_APP_ROLE_PASSWORD set', () => {
    let container: StartedPostgreSqlContainer;
    let client: Client;

    beforeAll(async () => {
      delete process.env[APP_ROLE_PASSWORD_ENV_VAR];
      container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();
    });

    afterAll(async () => {
      // Restore the module-level default so later describe blocks in this
      // file (which don't specifically test password validation) can still
      // run the app-role migration successfully.
      process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
      await client.end();
      await container.stop();
    });

    it('throws a clear configuration error instead of a cryptic SQL error', async () => {
      await expect(runMigrations(container.getConnectionUri(), 'up')).rejects.toThrow(
        /PARIMAAN_APP_ROLE_PASSWORD/,
      );
    });

    it('creates no parimaan_app role', async () => {
      const result = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [
        APP_ROLE,
      ]);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('with PARIMAAN_APP_ROLE_PASSWORD set', () => {
    let container: StartedPostgreSqlContainer;
    let client: Client;

    beforeAll(async () => {
      process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
      container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      await runMigrations(container.getConnectionUri(), 'up');
      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
      await container.stop();
    });

    beforeEach(async () => {
      await client.query(
        'TRUNCATE TABLE household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
      );
    });

    const connectAsAppRole = async (): Promise<Client> => {
      const uri = new URL(container.getConnectionUri());
      uri.username = APP_ROLE;
      uri.password = APP_ROLE_TEST_PASSWORD;
      const appClient = new Client({ connectionString: uri.toString() });
      await appClient.connect();
      return appClient;
    };

    it('creates parimaan_app as a non-superuser, non-BYPASSRLS login role', async () => {
      const result = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
        [APP_ROLE],
      );
      expect(firstRow(result.rows)).toMatchObject({ rolsuper: false, rolbypassrls: false });
    });

    it.each(BASELINE_TABLES)('allows parimaan_app to SELECT/INSERT/UPDATE/DELETE on %s', async () => {
      const appClient = await connectAsAppRole();
      try {
        const owner = await insertUser(appClient);
        const household = await insertHousehold(appClient, owner.id);
        // household_settings has an RLS policy applying to INSERT too (no
        // separate WITH CHECK was given, so Postgres reuses the USING
        // expression), and it's evaluated for parimaan_app since it's
        // neither the table owner nor a superuser — so this session-local
        // setting must be present, just as it must be for `rls_probe_role`
        // above. The policy's subquery also requires a matching
        // household_memberships row to already exist for this household_id
        // + user_id, so that insert must happen before household_settings.
        await appClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [owner.id]);
        const membership = await appClient.query<{ id: string }>(
          `INSERT INTO household_memberships (household_id, user_id, role)
           VALUES ($1, $2, 'primary') RETURNING id`,
          [household.id, owner.id],
        );
        await appClient.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
          household.id,
        ]);
        await appClient.query(`UPDATE households SET name = 'Renamed' WHERE id = $1`, [
          household.id,
        ]);
        await appClient.query(`DELETE FROM household_memberships WHERE id = $1`, [
          firstRow(membership.rows).id,
        ]);
      } finally {
        await appClient.end();
      }
    });

    it('denies parimaan_app CREATE TABLE', async () => {
      const appClient = await connectAsAppRole();
      try {
        await expect(appClient.query('CREATE TABLE should_not_exist (id INT)')).rejects.toThrow();
      } finally {
        await appClient.end();
      }
    });

    it('denies parimaan_app DROP TABLE', async () => {
      const appClient = await connectAsAppRole();
      try {
        await expect(appClient.query('DROP TABLE users')).rejects.toThrow();
      } finally {
        await appClient.end();
      }
    });

    it('denies parimaan_app ALTER TABLE (schema changes)', async () => {
      const appClient = await connectAsAppRole();
      try {
        await expect(
          appClient.query('ALTER TABLE users ADD COLUMN should_not_exist TEXT'),
        ).rejects.toThrow();
      } finally {
        await appClient.end();
      }
    });

    it('sets relforcerowsecurity on household_settings', async () => {
      const result = await client.query<{ relforcerowsecurity: boolean }>(
        `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'household_settings'`,
      );
      expect(firstRow(result.rows).relforcerowsecurity).toBe(true);
    });
  });
});

describe('reversing the app-role migration', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it('leaves no parimaan_app role behind after up then down, and baseline down still works', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    await runMigrations(container.getConnectionUri(), 'down');

    const roleResult = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [
      APP_ROLE,
    ]);
    expect(roleResult.rows).toHaveLength(0);

    for (const table of BASELINE_TABLES) {
      expect(await tableExists(client, table)).toBe(false);
    }
  });
});

describe('reversing the baseline-schema migration', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it('leaves no trace of the baseline tables after up then down', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    await runMigrations(container.getConnectionUri(), 'down');

    for (const table of BASELINE_TABLES) {
      expect(await tableExists(client, table)).toBe(false);
    }
  });
});
