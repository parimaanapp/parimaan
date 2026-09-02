import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';
import {
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  firstRow,
  insertHousehold,
  insertUser,
  tableExists,
} from './migrationTestHelpers.js';

/**
 * W8 S11's phase-boundary security sweep re-verified `household_settings`'s
 * RLS policy — the audit deferred since W5 (E2E_MVP_PLAN.md §11.2.2,
 * "separate backlog, not W5") — against a real Postgres instance and found
 * it was never actually exploitable: a `FOR ALL` policy with no explicit
 * `WITH CHECK` implicitly reuses `USING` for INSERT/UPDATE too. This file
 * is the cross-household insert/update test that gap was missing (only a
 * read-denial test existed in `migrations.test.ts`), now passing against
 * BOTH the pre-migration implicit-reuse shape and the explicit `WITH CHECK`
 * `1788000000000_household-settings-with-check.ts` adds — the migration
 * changes the policy's shape, not its behavior, so these tests were true
 * before it ran too; they just weren't written down anywhere until now.
 */
describe('household_settings_member, after the explicit WITH CHECK migration', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  const rlsProbeRole = 'household_settings_rls_probe_role';
  const rlsProbePassword = 'household_settings_rls_probe_password';

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD '${rlsProbePassword}'`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON household_settings, household_memberships TO ${rlsProbeRole}`,
    );
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE TABLE household_settings, household_memberships, households, users RESTART IDENTITY CASCADE',
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
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdId, userId],
    );
  };

  it("denies a non-member from inserting settings for another household via RLS (WITH CHECK)", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      await expect(
        asOutsider.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
          householdA.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOutsider.end();
    }
  });

  it("denies a non-member from updating another household's settings via RLS (WITH CHECK)", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    await client.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
      householdA.id,
    ]);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(
        `UPDATE household_settings SET allergens = '["peanuts"]' WHERE household_id = $1`,
        [householdA.id],
      );
      expect(result.rowCount).toBe(0);
    } finally {
      await asOutsider.end();
    }

    const unchanged = await client.query<{ allergens: string[] }>(
      `SELECT allergens FROM household_settings WHERE household_id = $1`,
      [householdA.id],
    );
    expect(firstRow(unchanged.rows).allergens).toEqual([]);
  });

  it('allows a real member to insert and update their own household settings via RLS', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);

    const asMember = await connectAsRlsProbe(owner.id);
    try {
      await asMember.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
        household.id,
      ]);
      const updated = await asMember.query(
        `UPDATE household_settings SET allergens = '["peanuts"]' WHERE household_id = $1`,
        [household.id],
      );
      expect(updated.rowCount).toBe(1);
    } finally {
      await asMember.end();
    }
  });
});

describe('reversing the household-settings-with-check migration', () => {
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

  it('a full down() then up() re-run leaves the policy in the same protective state — not dropped, not left implicit-only', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    await runMigrations(container.getConnectionUri(), 'down');
    expect(await tableExists(client, 'household_settings')).toBe(false);

    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();
    expect(await tableExists(client, 'household_settings')).toBe(true);

    // Re-verify the actual protective behavior survives the round trip, not
    // just that the table exists — a down()/up() that silently dropped the
    // WITH CHECK clause (or the policy entirely) would still pass a
    // table-existence check alone.
    const rlsProbeRole = 'household_settings_reup_probe_role';
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD 'reup_probe_password'`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON household_settings, household_memberships TO ${rlsProbeRole}`,
    );
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

    const uri = new URL(container.getConnectionUri());
    uri.username = rlsProbeRole;
    uri.password = 'reup_probe_password';
    const asOutsider = new Client({ connectionString: uri.toString() });
    await asOutsider.connect();
    await asOutsider.query(`SELECT set_config('parimaan.user_id', $1, false)`, [ownerB.id]);
    try {
      await expect(
        asOutsider.query(`INSERT INTO household_settings (household_id) VALUES ($1)`, [
          householdA.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOutsider.end();
    }
  });
});
