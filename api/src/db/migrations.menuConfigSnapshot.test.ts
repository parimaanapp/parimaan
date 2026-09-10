import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrationsDir, runMigrations } from './runMigrations.js';
import {
  APP_ROLE,
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  firstRow,
  getColumnTypes,
  insertHousehold,
  insertUser,
} from './migrationTestHelpers.js';

/**
 * W14 S1 (E2E_MVP_PLAN.md §20.3 "S1 — `menus.meal_config_snapshot`
 * migration + backfill"). Same Testcontainers-per-describe-block pattern as
 * `migrations.menus.test.ts`/`migrations.householdSettingsWithCheck.test.ts`.
 *
 * How many pending migrations to apply before inserting a `menus` row that
 * still needs the backfill to run against it — everything up to but not
 * including `1788500000001_menu-config-snapshot.ts` itself. Derived from the
 * directory rather than hardcoded so this stays correct if a migration is
 * ever inserted between the two (unlikely, but cheap to not assume).
 */
const migrationFileNames = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const snapshotMigrationIndex = migrationFileNames.findIndex((name) =>
  name.includes('menu-config-snapshot'),
);
if (snapshotMigrationIndex === -1) {
  throw new Error(
    'menu-config-snapshot migration file not found in api/migrations — test setup assumption broken.',
  );
}
const countBeforeSnapshotMigration = snapshotMigrationIndex;

describe('menus.meal_config_snapshot backfill', () => {
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

  const insertSettings = async (
    householdId: string,
    mealsEnabled: readonly string[],
    mealStructure: Record<string, unknown>,
  ): Promise<void> => {
    await client.query(
      `INSERT INTO household_settings (household_id, meals_enabled, meal_structure) VALUES ($1, $2, $3)`,
      [householdId, JSON.stringify(mealsEnabled), JSON.stringify(mealStructure)],
    );
  };

  const insertMenu = async (householdId: string, weekStartDate = '2026-09-07'): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO menus (household_id, week_start_date) VALUES ($1, $2) RETURNING id`,
      [householdId, weekStartDate],
    );
    return firstRow(result.rows);
  };

  it("backfills an existing menus row from its household's current settings, with both halves and snapshotAt present", async () => {
    // Bring the container up to (but not including) the migration under
    // test, so a `menus` row can be inserted under the pre-snapshot schema
    // — the exact "existing row from before this migration" scenario D2 is
    // meant to handle.
    await runMigrations(
      container.getConnectionUri(),
      'up',
      undefined,
      [APP_ROLE_TEST_PASSWORD],
      countBeforeSnapshotMigration,
    );

    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const customMealsEnabled = ['breakfast', 'lunch', 'dinner', 'snacks'];
    const customMealStructure = {
      lunch: { carb: 2, sabzi_dal: 3, accompaniment: 1 },
      dinner: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
    };
    await insertSettings(household.id, customMealsEnabled, customMealStructure);
    const menu = await insertMenu(household.id);

    const beforeMigrationRun = new Date();
    await runMigrations(container.getConnectionUri(), 'up');
    const afterMigrationRun = new Date();

    const result = await client.query<{
      meal_config_snapshot: { mealsEnabled: string[]; mealStructure: unknown; snapshotAt: string };
    }>(`SELECT meal_config_snapshot FROM menus WHERE id = $1`, [menu.id]);
    const snapshot = firstRow(result.rows).meal_config_snapshot;

    expect(snapshot.mealsEnabled).toEqual(customMealsEnabled);
    expect(snapshot.mealStructure).toEqual(customMealStructure);
    expect(typeof snapshot.snapshotAt).toBe('string');
    const snapshotAtDate = new Date(snapshot.snapshotAt);
    expect(Number.isNaN(snapshotAtDate.getTime())).toBe(false);
    // The migration's own run timestamp, not a fabricated creation time
    // (D2) — bounded loosely by the wall-clock window the migration
    // actually ran in, with a little slack for clock skew between this
    // process and the container.
    expect(snapshotAtDate.getTime()).toBeGreaterThanOrEqual(beforeMigrationRun.getTime() - 5000);
    expect(snapshotAtDate.getTime()).toBeLessThanOrEqual(afterMigrationRun.getTime() + 5000);
  });

  it('the real parimaan_app role can select the backfilled column with no further GRANT (table-level grant already covers it)', async () => {
    // This describe block's container is already fully migrated by the
    // previous test (`beforeAll` runs once per block, not per test), so
    // `runMigrations` here is a deliberate no-op re-assertion, not a second
    // partial run — the row below is inserted with the column already
    // `NOT NULL`, exercising the grant against the shipped end-state schema
    // rather than the backfill machinery (which the previous test already
    // covers).
    await runMigrations(container.getConnectionUri(), 'up');

    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await insertSettings(household.id, ['breakfast', 'lunch', 'dinner'], {
      lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
      dinner: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
    });
    const snapshot = {
      mealsEnabled: ['breakfast', 'lunch', 'dinner'],
      mealStructure: { lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 } },
      snapshotAt: new Date().toISOString(),
    };
    const insertedMenu = await client.query<{ id: string }>(
      `INSERT INTO menus (household_id, week_start_date, meal_config_snapshot) VALUES ($1, '2026-09-07', $2) RETURNING id`,
      [household.id, JSON.stringify(snapshot)],
    );
    const menu = firstRow(insertedMenu.rows);

    const appUri = new URL(container.getConnectionUri());
    appUri.username = APP_ROLE;
    appUri.password = APP_ROLE_TEST_PASSWORD;
    const appClient = new Client({ connectionString: appUri.toString() });
    await appClient.connect();
    try {
      await appClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [owner.id]);
      await expect(
        appClient.query(`SELECT meal_config_snapshot FROM menus WHERE id = $1`, [menu.id]),
      ).resolves.toBeDefined();
    } finally {
      await appClient.end();
    }
  });
});

describe('menus.meal_config_snapshot NOT NULL, once fully migrated', () => {
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
      'TRUNCATE TABLE menu_items, menus, household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
    );
  });

  it('reports the column as JSONB and NOT NULL', async () => {
    const columns = await getColumnTypes(client, 'menus');
    expect(columns.meal_config_snapshot).toBe('jsonb');

    const nullability = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'menus' AND column_name = 'meal_config_snapshot'`,
    );
    expect(firstRow(nullability.rows).is_nullable).toBe('NO');
  });

  it('rejects an insert that omits meal_config_snapshot', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);

    await expect(
      client.query(`INSERT INTO menus (household_id, week_start_date) VALUES ($1, '2026-09-07')`, [
        household.id,
      ]),
    ).rejects.toThrow(/null value in column "meal_config_snapshot"|violates not-null constraint/);
  });

  it('accepts an insert that provides meal_config_snapshot explicitly', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const snapshot = {
      mealsEnabled: ['breakfast', 'lunch', 'dinner'],
      mealStructure: { lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 } },
      snapshotAt: new Date().toISOString(),
    };

    await expect(
      client.query(
        `INSERT INTO menus (household_id, week_start_date, meal_config_snapshot) VALUES ($1, '2026-09-07', $2)`,
        [household.id, JSON.stringify(snapshot)],
      ),
    ).resolves.toBeDefined();
  });

  // §20.3 S1's own RLS RED test, verbatim: "the existing menus RLS policy
  // still denies a non-member reading a row carrying the new column — a
  // direct assertion, not an assumption." A row-level policy composes with
  // every column on the row it protects (there is no per-column ACL/RLS
  // concept in Postgres), but that is exactly the kind of thing this
  // codebase proves once rather than believes (§20.3's own words) — same
  // posture as every other "denies a non-member" test in
  // `migrations.menus.test.ts`, extended here to explicitly select the new
  // column rather than relying on that file's pre-existing coverage of
  // `menus` generally.
  it("denies a non-member from reading another household's menu's meal_config_snapshot via RLS", async () => {
    const rlsProbeRole = 'menu_config_snapshot_rls_probe_role';
    const rlsProbePassword = 'menu_config_snapshot_rls_probe_password';
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD '${rlsProbePassword}'`);
    await client.query(`GRANT SELECT, INSERT ON menus, household_memberships TO ${rlsProbeRole}`);

    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdA.id, ownerA.id],
    );
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdB.id, ownerB.id],
    );
    await client.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [householdA.id]);
    const snapshot = {
      mealsEnabled: ['breakfast', 'lunch', 'dinner'],
      mealStructure: { lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 } },
      snapshotAt: new Date().toISOString(),
    };
    const menu = await client.query<{ id: string }>(
      `INSERT INTO menus (household_id, week_start_date, meal_config_snapshot) VALUES ($1, '2026-09-07', $2) RETURNING id`,
      [householdA.id, JSON.stringify(snapshot)],
    );
    const menuId = firstRow(menu.rows).id;

    const probeUri = new URL(container.getConnectionUri());
    probeUri.username = rlsProbeRole;
    probeUri.password = rlsProbePassword;
    const asOutsider = new Client({ connectionString: probeUri.toString() });
    await asOutsider.connect();
    try {
      await asOutsider.query(`SELECT set_config('parimaan.user_id', $1, false)`, [ownerB.id]);
      const result = await asOutsider.query(
        `SELECT meal_config_snapshot FROM menus WHERE id = $1`,
        [menuId],
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await asOutsider.end();
    }

    // The member of the owning household, by contrast, can read it —
    // proving the denial above is RLS discriminating by membership and not
    // some blanket failure to select the new column at all.
    const asOutsiderButNowOwner = await connectAs(container, rlsProbeRole, rlsProbePassword, ownerA.id);
    try {
      const result = await asOutsiderButNowOwner.query(
        `SELECT meal_config_snapshot FROM menus WHERE id = $1`,
        [menuId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.meal_config_snapshot).toEqual(snapshot);
    } finally {
      await asOutsiderButNowOwner.end();
    }
  });
});

const connectAs = async (
  container: StartedPostgreSqlContainer,
  role: string,
  password: string,
  userId: string,
): Promise<Client> => {
  const uri = new URL(container.getConnectionUri());
  uri.username = role;
  uri.password = password;
  const probeClient = new Client({ connectionString: uri.toString() });
  await probeClient.connect();
  await probeClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [userId]);
  return probeClient;
};

describe('reversing the menu-config-snapshot migration', () => {
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

  it('down() drops only meal_config_snapshot (menus itself survives), and a subsequent up() re-run is clean', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    let columns = await getColumnTypes(client, 'menus');
    expect(columns.meal_config_snapshot).toBe('jsonb');

    await runMigrations(container.getConnectionUri(), 'down', undefined, [], 1);
    columns = await getColumnTypes(client, 'menus');
    expect(columns.meal_config_snapshot).toBeUndefined();
    // menus itself, and its other columns, are untouched by this migration's down().
    expect(columns.id).toBe('uuid');
    expect(columns.household_id).toBe('uuid');

    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();
    columns = await getColumnTypes(client, 'menus');
    expect(columns.meal_config_snapshot).toBe('jsonb');

    const nullability = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'menus' AND column_name = 'meal_config_snapshot'`,
    );
    expect(firstRow(nullability.rows).is_nullable).toBe('NO');
  });
});
