import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';
import {
  APP_ROLE,
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  firstRow,
  getColumnTypes,
  insertHousehold,
  insertUser,
  tableExists,
} from './migrationTestHelpers.js';

/**
 * Split out of `migrations.test.ts`/`migrations.recipes.test.ts` (the
 * file-organization 800-line cap), same Testcontainers-per-describe-block
 * pattern. Unlike every other RLS test file here, this table's policy is
 * **per-user**, not membership-scoped (E2E_MVP_PLAN.md §14.2.7) — the
 * highest-value test in this file is proving a fellow household member,
 * who genuinely IS a member, still cannot read or write another member's
 * row. A membership-scoped policy would pass every test a naive suite
 * might write and still be the real vulnerability §14.2.7 names.
 */
describe('notification_preferences, once migrated', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  const rlsProbeRole = 'notification_prefs_rls_probe_role';
  const rlsProbePassword = 'notification_prefs_rls_probe_password';

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD '${rlsProbePassword}'`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO ${rlsProbeRole}`);
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE TABLE notification_preferences, household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
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

  const addMember = async (householdId: string, userId: string): Promise<void> => {
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
      [householdId, userId],
    );
  };

  const insertPrefsRow = async (userId: string, householdId: string): Promise<void> => {
    await client.query(`INSERT INTO notification_preferences (user_id, household_id) VALUES ($1, $2)`, [
      userId,
      householdId,
    ]);
  };

  it('creates the notification_preferences table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'notification_preferences');
    expect(columns).toMatchObject({
      user_id: 'uuid',
      household_id: 'uuid',
      list_changes: 'boolean',
      meal_reminder: 'boolean',
      expiry: 'boolean',
      activity: 'boolean',
      fcm_token: 'text',
    });
  });

  it('rejects a second row for the same (user_id, household_id) pair — the composite PK', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await insertPrefsRow(owner.id, household.id);

    await expect(insertPrefsRow(owner.id, household.id)).rejects.toThrow();
  });

  it('rejects a row referencing a non-existent user_id or household_id', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);

    await expect(insertPrefsRow(randomUUID(), household.id)).rejects.toThrow();
    await expect(insertPrefsRow(owner.id, randomUUID())).rejects.toThrow();
  });

  it('cascades household deletion to notification_preferences', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await insertPrefsRow(owner.id, household.id);

    await client.query(`DELETE FROM households WHERE id = $1`, [household.id]);

    const remaining = await client.query(`SELECT 1 FROM notification_preferences WHERE household_id = $1`, [
      household.id,
    ]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('cascades user deletion to notification_preferences', async () => {
    // A second, non-primary member: `households.primary_user_id` has its
    // own FK back to `users` (not CASCADE), so deleting the household's
    // primary user here would hit that constraint instead of exercising
    // notification_preferences' own user_id CASCADE.
    const owner = await insertUser(client);
    const member = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, member.id);
    await insertPrefsRow(member.id, household.id);

    await client.query(`DELETE FROM users WHERE id = $1`, [member.id]);

    const remaining = await client.query(`SELECT 1 FROM notification_preferences WHERE user_id = $1`, [
      member.id,
    ]);
    expect(remaining.rows).toHaveLength(0);
  });

  it("allows a user to read their own row via RLS", async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    await insertPrefsRow(owner.id, household.id);

    const asOwner = await connectAsRlsProbe(owner.id);
    try {
      const result = await asOwner.query(
        `SELECT user_id FROM notification_preferences WHERE household_id = $1`,
        [household.id],
      );
      expect(result.rows).toHaveLength(1);
    } finally {
      await asOwner.end();
    }
  });

  // The single most important test in this file (E2E_MVP_PLAN.md §14.2.7):
  // a fellow member of the SAME household — a real, genuine member, not an
  // outsider — must still not be able to read another member's row. A
  // household-scoped (membership-subquery) policy would pass this test's
  // outsider variant but fail this one, and this is the one that matters.
  it("denies a fellow member of the same household from reading another member's row via RLS", async () => {
    const owner = await insertUser(client);
    const other = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    await addMember(household.id, other.id);
    await insertPrefsRow(owner.id, household.id);

    const asOther = await connectAsRlsProbe(other.id);
    try {
      const result = await asOther.query(
        `SELECT user_id FROM notification_preferences WHERE household_id = $1 AND user_id = $2`,
        [household.id, owner.id],
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await asOther.end();
    }
  });

  it("denies a fellow member of the same household from updating another member's row via RLS (WITH CHECK)", async () => {
    const owner = await insertUser(client);
    const other = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    await addMember(household.id, other.id);
    await insertPrefsRow(owner.id, household.id);

    const asOther = await connectAsRlsProbe(other.id);
    try {
      const result = await asOther.query(
        `UPDATE notification_preferences SET list_changes = FALSE WHERE user_id = $1 AND household_id = $2`,
        [owner.id, household.id],
      );
      expect(result.rowCount).toBe(0);
    } finally {
      await asOther.end();
    }

    const unchanged = await client.query<{ list_changes: boolean }>(
      `SELECT list_changes FROM notification_preferences WHERE user_id = $1 AND household_id = $2`,
      [owner.id, household.id],
    );
    expect(firstRow(unchanged.rows).list_changes).toBe(true);
  });

  it("denies a fellow member of the same household from inserting a row on another member's behalf via RLS (WITH CHECK)", async () => {
    const owner = await insertUser(client);
    const other = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    await addMember(household.id, other.id);

    const asOther = await connectAsRlsProbe(other.id);
    try {
      await expect(
        asOther.query(
          `INSERT INTO notification_preferences (user_id, household_id) VALUES ($1, $2)`,
          [owner.id, household.id],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOther.end();
    }
  });

  it('lets the real parimaan_app role do full CRUD on notification_preferences (the grant this migration adds)', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);

    const appUri = new URL(container.getConnectionUri());
    appUri.username = APP_ROLE;
    appUri.password = APP_ROLE_TEST_PASSWORD;
    const appClient = new Client({ connectionString: appUri.toString() });
    await appClient.connect();
    try {
      await appClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [owner.id]);
      await appClient.query(
        `INSERT INTO notification_preferences (user_id, household_id) VALUES ($1, $2)`,
        [owner.id, household.id],
      );
      await appClient.query(
        `UPDATE notification_preferences SET meal_reminder = FALSE WHERE user_id = $1 AND household_id = $2`,
        [owner.id, household.id],
      );
      const selected = await appClient.query(
        `SELECT meal_reminder FROM notification_preferences WHERE user_id = $1 AND household_id = $2`,
        [owner.id, household.id],
      );
      expect(firstRow(selected.rows).meal_reminder).toBe(false);

      const deleted = await appClient.query(
        `DELETE FROM notification_preferences WHERE user_id = $1 AND household_id = $2`,
        [owner.id, household.id],
      );
      expect(deleted.rowCount).toBe(1);
    } finally {
      await appClient.end();
    }
  });
});

describe('reversing the notification_preferences migration', () => {
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

  it('leaves no trace of notification_preferences after up then down, and can be re-run cleanly', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    await runMigrations(container.getConnectionUri(), 'down');

    expect(await tableExists(client, 'notification_preferences')).toBe(false);

    // Re-running the whole set from scratch must not throw — the concrete
    // regression this guards is a down() that leaves some artifact (a
    // policy, a grant) that makes the *next* up() fail.
    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();
    expect(await tableExists(client, 'notification_preferences')).toBe(true);
  });
});
