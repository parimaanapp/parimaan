import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createMenu as createMenuRepo } from '../repositories/menuRepository.js';
import { insertRecipe } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createAutoFillPreviewHandler } from './autoFillPreview.js';
import type { AutoFillPreviewResolverDeps } from './autoFillPreview.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  menuId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown }> => ({
  arguments: { menuId },
  identity:
    cognitoSub === null
      ? null
      : ({
          sub: cognitoSub,
          issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
          username: cognitoSub,
          claims: { email: `${cognitoSub}@example.test` },
          sourceIp: ['127.0.0.1'],
          defaultAuthStrategy: 'ALLOW',
          groups: null,
        } as unknown as AppSyncResolverEvent<{ menuId: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['items', 'filledCount', 'unfilledSlots'],
    selectionSetGraphQL: '{ items { recipeId } filledCount unfilledSlots { dayOfWeek } }',
    parentTypeName: 'Query',
    fieldName: 'autoFillPreview',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('autoFillPreview resolver (Query.autoFillPreview)', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const baseDeps: AutoFillPreviewResolverDeps = { getPool: async () => pool };

  const createUser = async (cognitoSub: string): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, {
        cognitoSub,
        email: `${cognitoSub}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const createHouseholdWithOwner = async (owner: UserRow, inviteCode: string): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, {
          name: `House ${inviteCode}`,
          inviteCode,
          primaryUserId: owner.id,
        });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        return household.id;
      },
      pool,
    );

  const createMenuFor = async (owner: UserRow, householdId: string, weekStartDate: string): Promise<string> =>
    withUserTransaction(owner.id, (client) => createMenuRepo(client, householdId, weekStartDate), pool).then(
      (menu) => menu.id,
    );

  const addRecipe = async (
    client: PoolClient,
    householdId: string,
    createdBy: string,
    overrides: { title?: string; role?: string; inRotation?: boolean } = {},
  ): Promise<string> => {
    const recipe = await insertRecipe(client, {
      householdId,
      sourceType: 'user',
      sourceUrl: null,
      title: overrides.title ?? 'Rajma',
      description: null,
      servings: 4,
      prepMin: null,
      cookMin: null,
      cuisineTier1: null,
      cuisineTier2: null,
      dietaryTags: [],
      role: overrides.role ?? 'carb',
      inRotation: overrides.inRotation ?? true,
      steps: [],
      createdBy,
    });
    return recipe.id;
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-afp-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'AFP234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createAutoFillPreviewHandler(baseDeps);
    await expect(handler(buildEvent(menuId, null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-uuid menuId with ValidationError', async () => {
    const handler = createAutoFillPreviewHandler(baseDeps);
    await expect(handler(buildEvent('not-a-uuid', 'sub-afp-validation'))).rejects.toThrow(ValidationError);
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-afp-oracle-probe');
    const handler = createAutoFillPreviewHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-afp-oracle-probe'))).rejects.toThrow(ForbiddenError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-afp-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'AFD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-afp-stranger');

    const handler = createAutoFillPreviewHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 'sub-afp-stranger'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('writes nothing to menu_items, under any circumstance', async () => {
    const owner = await createUser('sub-afp-nowrite');
    const householdId = await createHouseholdWithOwner(owner, 'AFW234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);

    const handler = createAutoFillPreviewHandler(baseDeps);
    await handler(buildEvent(menuId, 'sub-afp-nowrite'));

    const count = await db.adminClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menu_items WHERE menu_id = $1`,
      [menuId],
    );
    expect(Number(count.rows[0]?.count)).toBe(0);
  });

  it('can be called repeatedly with no confirmation and no side effect — the free "regenerate" property', async () => {
    const owner = await createUser('sub-afp-repeat');
    const householdId = await createHouseholdWithOwner(owner, 'AFR234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);

    const handler = createAutoFillPreviewHandler(baseDeps);
    const first = await handler(buildEvent(menuId, 'sub-afp-repeat'));
    const second = await handler(buildEvent(menuId, 'sub-afp-repeat'));

    expect(first.filledCount).toBeGreaterThan(0);
    expect(second.filledCount).toBeGreaterThan(0);
  });

  it('never proposes an out-of-rotation recipe', async () => {
    const owner = await createUser('sub-afp-rotation');
    const householdId = await createHouseholdWithOwner(owner, 'AFN234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { inRotation: false }),
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-rotation'));

    expect(result.items).toHaveLength(0);
    expect(result.filledCount).toBe(0);
    expect(result.unfilledSlots.length).toBeGreaterThan(0);
  });

  it('a household with every meal type disabled proposes an empty result cleanly, not an error', async () => {
    const owner = await createUser('sub-afp-nomeals');
    const householdId = await createHouseholdWithOwner(owner, 'AFM234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await db.adminClient.query(`UPDATE household_settings SET meals_enabled = '[]'::jsonb WHERE household_id = $1`, [
      householdId,
    ]);
    await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-nomeals'));

    expect(result.items).toEqual([]);
    expect(result.filledCount).toBe(0);
    expect(result.unfilledSlots).toEqual([]);
  });

  it('proposes a cuisineTier1-matching, higher-weighted recipe disproportionately more often than a non-matching one across many independent preview calls', async () => {
    const owner = await createUser('sub-afp-bias');
    const householdId = await createHouseholdWithOwner(owner, 'AFB234');
    await db.adminClient.query(
      `UPDATE household_settings SET cuisine_tier1 = '["north_indian"]'::jsonb WHERE household_id = $1`,
      [householdId],
    );
    await withUserTransaction(
      owner.id,
      async (client) => {
        await client.query(
          `INSERT INTO recipes (household_id, source_type, title, role, in_rotation, cuisine_tier1, created_by) VALUES ($1, 'user', 'Matching', 'carb', true, 'north_indian', $2)`,
          [householdId, owner.id],
        );
        await client.query(
          `INSERT INTO recipes (household_id, source_type, title, role, in_rotation, cuisine_tier1, created_by) VALUES ($1, 'user', 'NonMatching', 'carb', true, 'south_indian', $2)`,
          [householdId, owner.id],
        );
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    let matchingCount = 0;
    const trials = 30;
    for (let i = 0; i < trials; i += 1) {
      // A distinct week per trial (one Query.autoFillPreview call per menu
      // is deliberately unseeded — D11 — so reusing the same menu would
      // just re-sample the same distribution; distinct weeks aren't
      // required for randomness, but createMenu is idempotent per
      // (household, week), so a fresh week per trial is the simplest way
      // to get a fresh menu each time without a second helper.
      const weekStart = new Date(Date.UTC(2026, 8, 7 + i * 7)); // 2026-09-07 + i weeks
      const weekStartDate = weekStart.toISOString();
      const menuId = await createMenuFor(owner, householdId, weekStartDate);
      const result = await handler(buildEvent(menuId, 'sub-afp-bias'));
      const day0LunchCarb = result.items.find(
        (item) => item.dayOfWeek === 0 && item.mealSlot === 'lunch' && item.slotRole === 'carb',
      );
      if (day0LunchCarb?.recipe.title === 'Matching') {
        matchingCount += 1;
      }
    }

    // Base weight 1.0 vs. tier-1-matched weight 2.0 (a 2:1 ratio) should
    // land well north of a 50/50 split across enough trials — a genuine
    // proof the cuisine-bias wiring (household settings -> scoreCandidate)
    // actually affects the distribution, not just a code trace.
    expect(matchingCount).toBeGreaterThan(trials * 0.55);
  });

  it('a zero-recipe household proposes nothing, and every empty slot is reported as unfilled — never an error', async () => {
    const owner = await createUser('sub-afp-empty');
    const householdId = await createHouseholdWithOwner(owner, 'AFE234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-empty'));

    expect(result.items).toEqual([]);
    expect(result.filledCount).toBe(0);
    // Default settings enable breakfast/lunch/dinner: 1 + 4 + 4 = 9 slots/day x 7 days = 63.
    expect(result.unfilledSlots).toHaveLength(63);
  });

  it('a full-rotation household proposes a full week, never exceeding any cap, with hydrated recipe details', async () => {
    const owner = await createUser('sub-afp-full');
    const householdId = await createHouseholdWithOwner(owner, 'AFU234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(
      owner.id,
      async (client) => {
        await addRecipe(client, householdId, owner.id, { title: 'Breakfast Recipe', role: 'breakfast' });
        await addRecipe(client, householdId, owner.id, { title: 'Carb Recipe', role: 'carb' });
        await addRecipe(client, householdId, owner.id, { title: 'Sabzi 1', role: 'sabzi_dal' });
        await addRecipe(client, householdId, owner.id, { title: 'Sabzi 2', role: 'sabzi_dal' });
        await addRecipe(client, householdId, owner.id, { title: 'Accompaniment Recipe', role: 'accompaniment' });
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-full'));

    expect(result.filledCount).toBe(63);
    expect(result.unfilledSlots).toEqual([]);
    expect(result.items.every((item) => item.recipe.title.length > 0)).toBe(true);

    // Cap check, per (dayOfWeek, mealSlot, slotRole): breakfast caps at 1,
    // lunch sabzi_dal caps at 2 (DEFAULT_MEAL_STRUCTURE).
    const day0Breakfast = result.items.filter((item) => item.dayOfWeek === 0 && item.mealSlot === 'breakfast');
    expect(day0Breakfast).toHaveLength(1);
    const day0LunchSabzi = result.items.filter(
      (item) => item.dayOfWeek === 0 && item.mealSlot === 'lunch' && item.slotRole === 'sabzi_dal',
    );
    expect(day0LunchSabzi).toHaveLength(2);
  });

  it('never proposes a skip-listed-ingredient recipe (hard filter, unlike the picker which only marks it)', async () => {
    const owner = await createUser('sub-afp-skip');
    const householdId = await createHouseholdWithOwner(owner, 'AFS234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(
      owner.id,
      async (client) => {
        const recipeId = await addRecipe(client, householdId, owner.id, { title: 'Peanut Sabzi' });
        await client.query(`INSERT INTO recipe_ingredients (recipe_id, name, sort_order) VALUES ($1, 'Peanuts', 0)`, [
          recipeId,
        ]);
        await client.query(
          `UPDATE household_settings SET skip_ingredients = '["peanut"]'::jsonb WHERE household_id = $1`,
          [householdId],
        );
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-skip'));

    expect(result.items).toHaveLength(0);
  });

  it('never proposes a recipe missing a required dietary tag, even when it is otherwise the best-scoring candidate (hard filter, W10 S7 finding)', async () => {
    const owner = await createUser('sub-afp-dietary');
    const householdId = await createHouseholdWithOwner(owner, 'AFD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(
      owner.id,
      async (client) => {
        await client.query(
          `UPDATE household_settings SET dietary_tags = '["veg"]'::jsonb, cuisine_tier1 = '["north_indian"]'::jsonb WHERE household_id = $1`,
          [householdId],
        );
        // In-rotation, cuisine-matching, no recency penalty — the best
        // possible score — but not vegetarian, so it must never be
        // proposed regardless of how favorably it would otherwise score.
        await client.query(
          `INSERT INTO recipes (household_id, source_type, title, role, in_rotation, cuisine_tier1, dietary_tags, created_by)
           VALUES ($1, 'user', 'Chicken Curry', 'carb', true, 'north_indian', '[]'::jsonb, $2)`,
          [householdId, owner.id],
        );
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-dietary'));

    expect(result.items).toHaveLength(0);
  });

  it('a recipe satisfying multiple required dietary tags simultaneously remains eligible', async () => {
    const owner = await createUser('sub-afp-dietary-multi');
    const householdId = await createHouseholdWithOwner(owner, 'AFDM23');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(
      owner.id,
      async (client) => {
        await client.query(
          `UPDATE household_settings SET dietary_tags = '["veg", "gluten_free"]'::jsonb WHERE household_id = $1`,
          [householdId],
        );
        await client.query(
          `INSERT INTO recipes (household_id, source_type, title, role, in_rotation, dietary_tags, created_by)
           VALUES ($1, 'user', 'Veg GF Khichdi', 'carb', true, '["veg", "gluten_free", "dairy_free"]'::jsonb, $2)`,
          [householdId, owner.id],
        );
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-dietary-multi'));

    expect(result.items.some((item) => item.recipe.title === 'Veg GF Khichdi')).toBe(true);
  });

  it('a household with no dietaryTags requirement is unaffected — every recipe remains eligible regardless of its own tags', async () => {
    const owner = await createUser('sub-afp-dietary-none');
    const householdId = await createHouseholdWithOwner(owner, 'AFDN23');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await withUserTransaction(
      owner.id,
      async (client) => {
        // Default settings' dietaryTags is [] — no UPDATE needed. A recipe
        // with no dietary tags of its own must still be proposed.
        await addRecipe(client, householdId, owner.id, { title: 'Untagged Recipe', role: 'carb' });
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-dietary-none'));

    expect(result.items.some((item) => item.recipe.title === 'Untagged Recipe')).toBe(true);
  });

  it('an existing item reduces the proposal for its own slot — filled slots are never re-proposed', async () => {
    const owner = await createUser('sub-afp-existing');
    const householdId = await createHouseholdWithOwner(owner, 'AFX234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    let carbId = '';
    await withUserTransaction(
      owner.id,
      async (client) => {
        carbId = await addRecipe(client, householdId, owner.id, { role: 'carb' });
        await client.query(
          `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
          [menuId, carbId],
        );
      },
      pool,
    );

    const handler = createAutoFillPreviewHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-afp-existing'));

    // carb's cap is 1/day for lunch — already filled on day 0, so no
    // proposal should target (day 0, lunch, carb).
    const day0LunchCarb = result.items.filter(
      (item) => item.dayOfWeek === 0 && item.mealSlot === 'lunch' && item.slotRole === 'carb',
    );
    expect(day0LunchCarb).toHaveLength(0);
  });
});
