import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { createPgWipeDb } from './pgWipeDb.js';

/**
 * Real Postgres (Testcontainers) with every real migration applied: proves the
 * deletion order is FK-safe against the actual schema, that a household shared
 * with a non-wipe user survives, and that the execute path is one transaction.
 */
let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db.stop();
});

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.adminClient.query(sql, params)).rows as T[];

const addUser = async (email: string): Promise<{ id: string; sub: string }> => {
  const sub = `sub-${randomUUID()}`;
  const [row] = await q<{ id: string }>(
    `INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id`,
    [sub, email],
  );
  return { id: (row as { id: string }).id, sub };
};

const addHousehold = async (
  name: string,
  primaryUserId: string,
  memberIds: string[],
): Promise<string> => {
  const [row] = await q<{ id: string }>(
    `INSERT INTO households (name, invite_code, primary_user_id) VALUES ($1, $2, $3) RETURNING id`,
    [name, randomUUID().slice(0, 8), primaryUserId],
  );
  const id = (row as { id: string }).id;
  await q(`INSERT INTO household_settings (household_id) VALUES ($1)`, [id]);
  for (const userId of memberIds) {
    await q(`INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1,$2,$3)`, [
      id,
      userId,
      userId === primaryUserId ? 'primary' : 'member',
    ]);
  }
  return id;
};

const populate = async (householdId: string, userId: string): Promise<void> => {
  await q(`INSERT INTO pantry_items (household_id, name, unit, added_by) VALUES ($1,'rice','kg',$2)`, [
    householdId,
    userId,
  ]);
  const [recipe] = await q<{ id: string }>(
    `INSERT INTO recipes (household_id, source_type, title, role, created_by)
     VALUES ($1,'user','Dal','sabzi_dal',$2) RETURNING id`,
    [householdId, userId],
  );
  const recipeId = (recipe as { id: string }).id;
  await q(`INSERT INTO recipe_ingredients (recipe_id, name) VALUES ($1,'dal')`, [recipeId]);
  const [menu] = await q<{ id: string }>(
    `INSERT INTO menus (household_id, week_start_date, meal_config_snapshot)
     VALUES ($1,'2026-10-12','{"mealsEnabled":["lunch"],"mealStructure":{}}') RETURNING id`,
    [householdId],
  );
  const menuId = (menu as { id: string }).id;
  await q(
    `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role)
     VALUES ($1,$2,0,'lunch','sabzi_dal')`,
    [menuId, recipeId],
  );
  const [list] = await q<{ id: string }>(
    `INSERT INTO shopping_lists (household_id, generated_from_menu_id) VALUES ($1,$2) RETURNING id`,
    [householdId, menuId],
  );
  await q(
    `INSERT INTO shopping_list_items (shopping_list_id, name, source_recipe_id, purchased_by)
     VALUES ($1,'dal',$2,$3)`,
    [(list as { id: string }).id, recipeId, userId],
  );
  await q(`INSERT INTO notification_preferences (user_id, household_id) VALUES ($1,$2)`, [
    userId,
    householdId,
  ]);
};

const count = async (table: string): Promise<number> =>
  Number(((await q<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0] as { n: string }).n);

describe('createPgWipeDb (real Postgres, real migrations)', () => {
  it('lists, then deletes in FK-safe order; keeps a shared household and promotes a new primary', async () => {
    const wipeA = await addUser('wipe-a@example.test');
    const wipeB = await addUser('wipe-b@example.test');
    const outsider = await addUser('outsider@example.test');

    const ownHousehold = await addHousehold('Own', wipeA.id, [wipeA.id, wipeB.id]);
    const sharedHousehold = await addHousehold('Shared', wipeA.id, [wipeA.id, outsider.id]);
    const untouched = await addHousehold('Untouched', outsider.id, [outsider.id]);
    await populate(ownHousehold, wipeA.id);
    await populate(sharedHousehold, wipeA.id);
    await populate(untouched, outsider.id);

    const wipe = createPgWipeDb(db.adminClient);
    const emails = ['wipe-a@example.test', 'wipe-b@example.test'];

    const listing = await wipe.snapshot(emails, []);
    expect(listing.users.map((u) => u.email).sort()).toEqual(emails);
    expect(listing.householdsDeleted.map((h) => h.id)).toEqual([ownHousehold]);
    expect(listing.householdsKept).toEqual([
      { id: sharedHousehold, name: 'Shared', remainingMemberCount: 1, wipedMemberCount: 1 },
    ]);
    expect(listing.promotions).toHaveLength(1);
    expect(listing.promotions[0]?.newPrimaryUserId).toBe(outsider.id);
    const pantry = listing.tables.find((t) => t.table === 'pantry_items');
    expect(pantry?.keys).toHaveLength(1);
    const nullified = listing.nullifiedReferences.find((r) => r.table === 'pantry_items');
    expect(nullified?.count).toBe(1);

    // Dry run mutated nothing.
    expect(await count('users')).toBe(3);

    const staleListing = { ...listing, users: [] };
    await expect(wipe.execute(emails, [], staleListing)).rejects.toThrow(/no longer matches/);
    expect(await count('users')).toBe(3);

    await wipe.execute(emails, [], listing);

    expect(await count('users')).toBe(1);
    expect(await count('households')).toBe(2);
    const [primary] = await q<{ primary_user_id: string }>(
      `SELECT primary_user_id FROM households WHERE id = $1`,
      [sharedHousehold],
    );
    expect(primary?.primary_user_id).toBe(outsider.id);
    const [membershipRole] = await q<{ role: string }>(
      `SELECT role FROM household_memberships WHERE household_id = $1 AND user_id = $2`,
      [sharedHousehold, outsider.id],
    );
    expect(membershipRole?.role).toBe('primary');
    // The shared household's own data survives; only attribution is nulled.
    const [pantryRow] = await q<{ added_by: string | null }>(
      `SELECT added_by FROM pantry_items WHERE household_id = $1`,
      [sharedHousehold],
    );
    expect(pantryRow?.added_by).toBeNull();
    expect(await count('pantry_items')).toBe(2);

    // Second run is a no-op.
    const again = await wipe.snapshot(emails, []);
    expect(again.users).toEqual([]);
    expect(again.tables.every((t) => t.keys.length === 0)).toBe(true);
    await wipe.execute(emails, [], again);
    expect(await count('users')).toBe(1);
  });

  it('refuses to run as a role that cannot bypass row level security', async () => {
    const { Client } = await import('pg');
    const appClient = new Client({ connectionString: db.appUri });
    await appClient.connect();
    try {
      const wipe = createPgWipeDb(appClient);
      await expect(wipe.snapshot(['a@example.test'], [])).rejects.toThrow(/row.level security/i);
    } finally {
      await appClient.end();
    }
  });
});
