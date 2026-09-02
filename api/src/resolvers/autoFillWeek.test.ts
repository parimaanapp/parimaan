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
import { createAutoFillWeekHandler } from './autoFillWeek.js';
import type { AutoFillWeekResolverDeps } from './autoFillWeek.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  menuId: unknown,
  overwrite: unknown,
  items: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown; overwrite: unknown; items: unknown }> => ({
  arguments: { menuId, overwrite, items },
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
        } as unknown as AppSyncResolverEvent<{ menuId: unknown; overwrite: unknown; items: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['menu', 'filledCount', 'unfilledSlots'],
    selectionSetGraphQL: '{ menu { id } filledCount unfilledSlots { dayOfWeek } }',
    parentTypeName: 'Mutation',
    fieldName: 'autoFillWeek',
    variables: {},
  },
  prev: null,
  stash: {},
});

const addMenuItemBuildEvent = (
  menuId: unknown,
  input: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown; input: unknown }> => ({
  arguments: { menuId, input },
  identity: {
    sub: cognitoSub,
    issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
    username: cognitoSub,
    claims: { email: `${cognitoSub}@example.test` },
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
  } as unknown as AppSyncResolverEvent<{ menuId: unknown; input: unknown }>['identity'],
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'addMenuItem',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('autoFillWeek resolver (Mutation.autoFillWeek)', () => {
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

  const baseDeps: AutoFillWeekResolverDeps = { getPool: async () => pool };

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

  const item = (recipeId: string, dayOfWeek: number, mealSlot: string, slotRole: string): unknown => ({
    recipeId,
    dayOfWeek,
    mealSlot,
    slotRole,
  });

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-afw-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'AFW234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createAutoFillWeekHandler(baseDeps);
    await expect(handler(buildEvent(menuId, false, [], null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid menuId', 'not-a-uuid', false, []],
    ['explicit null overwrite (non-nullable, must be rejected)', undefined, null, []],
    ['a malformed item (missing recipeId)', undefined, false, [{ dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' }]],
  ])('rejects invalid input (%s) with ValidationError', async (_label, menuId, overwrite, items) => {
    const handler = createAutoFillWeekHandler(baseDeps);
    await expect(handler(buildEvent(menuId, overwrite, items, 'sub-afw-validation'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-afw-oracle-probe');
    const handler = createAutoFillWeekHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), false, [], 'sub-afw-oracle-probe'))).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-afw-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'AWD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-afw-stranger');

    const handler = createAutoFillWeekHandler(baseDeps);
    await expect(handler(buildEvent(menuId, false, [], 'sub-afw-stranger'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('commits every submitted item that passes live validation', async () => {
    const owner = await createUser('sub-afw-commit');
    const householdId = await createHouseholdWithOwner(owner, 'AWC234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, false, [item(recipeId, 0, 'lunch', 'carb')], 'sub-afw-commit'),
    );

    expect(result.filledCount).toBe(1);
    expect(result.unfilledSlots).toEqual([]);
    expect(result.menu.items).toHaveLength(1);
  });

  it('overwrite: false leaves existing items untouched and only adds the submitted ones', async () => {
    const owner = await createUser('sub-afw-preserve');
    const householdId = await createHouseholdWithOwner(owner, 'AWP234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 3, 'dinner', 'carb')`,
      [menuId, recipeId],
    );

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, false, [item(recipeId, 0, 'lunch', 'carb')], 'sub-afw-preserve'),
    );

    expect(result.menu.items).toHaveLength(2);
  });

  it('overwrite: true replaces every unmade item (manual or auto-filled) and preserves made items', async () => {
    const owner = await createUser('sub-afw-overwrite');
    const householdId = await createHouseholdWithOwner(owner, 'AWO234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);

    const unmadeResult = await db.adminClient.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 3, 'dinner', 'carb') RETURNING id`,
      [menuId, recipeId],
    );
    const madeResult = await db.adminClient.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role, made_at) VALUES ($1, $2, 4, 'dinner', 'carb', NOW()) RETURNING id`,
      [menuId, recipeId],
    );
    const madeId = madeResult.rows[0]?.id;

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, true, [item(recipeId, 0, 'lunch', 'carb')], 'sub-afw-overwrite'),
    );

    const resultIds = result.menu.items.map((i) => i.id);
    expect(resultIds).not.toContain(unmadeResult.rows[0]?.id);
    expect(resultIds).toContain(madeId);
    expect(result.menu.items).toHaveLength(2); // the preserved made item + the newly-committed one
  });

  it('overwrite: true against an already-empty menu (nothing to delete) commits normally, no error', async () => {
    const owner = await createUser('sub-afw-overwrite-empty');
    const householdId = await createHouseholdWithOwner(owner, 'AWE234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id), pool);

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, true, [item(recipeId, 0, 'lunch', 'carb')], 'sub-afw-overwrite-empty'),
    );

    expect(result.filledCount).toBe(1);
    expect(result.menu.items).toHaveLength(1);
  });

  it('a batch mixing a legitimate item with a foreign-household item commits only the legitimate one — per-item isolation, not all-or-nothing', async () => {
    const owner = await createUser('sub-afw-mixed-owner');
    const householdId = await createHouseholdWithOwner(owner, 'AWM234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const legitRecipe = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'Legit' }), pool);

    const otherOwner = await createUser('sub-afw-mixed-other');
    const otherHouseholdId = await createHouseholdWithOwner(otherOwner, 'AWN234');
    const foreignRecipe = await withUserTransaction(
      otherOwner.id,
      (client) => addRecipe(client, otherHouseholdId, otherOwner.id, { title: 'Foreign' }),
      pool,
    );

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(
        menuId,
        false,
        [item(legitRecipe, 0, 'lunch', 'carb'), item(foreignRecipe, 1, 'lunch', 'carb')],
        'sub-afw-mixed-owner',
      ),
    );

    expect(result.filledCount).toBe(1);
    expect(result.unfilledSlots).toEqual([{ dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'carb' }]);
    expect(result.menu.items).toHaveLength(1);
    expect(result.menu.items[0]?.recipe.title).toBe('Legit');
  });

  it('never commits a recipe that is not in rotation, even if submitted', async () => {
    const owner = await createUser('sub-afw-rotation');
    const householdId = await createHouseholdWithOwner(owner, 'AWR234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { inRotation: false }),
      pool,
    );

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, false, [item(recipeId, 0, 'lunch', 'carb')], 'sub-afw-rotation'),
    );

    expect(result.filledCount).toBe(0);
    expect(result.unfilledSlots).toEqual([{ dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' }]);
  });

  it('never commits an item from another household — the exact addMenuItem cross-household check, at the batch level', async () => {
    const owner = await createUser('sub-afw-crosshh-owner');
    const householdId = await createHouseholdWithOwner(owner, 'AWH234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const otherOwner = await createUser('sub-afw-crosshh-other');
    const otherHouseholdId = await createHouseholdWithOwner(otherOwner, 'AWX234');
    const foreignRecipeId = await withUserTransaction(
      otherOwner.id,
      (client) => addRecipe(client, otherHouseholdId, otherOwner.id),
      pool,
    );

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, false, [item(foreignRecipeId, 0, 'lunch', 'carb')], 'sub-afw-crosshh-owner'),
    );

    expect(result.filledCount).toBe(0);
    expect(result.unfilledSlots).toHaveLength(1);
  });

  it('never exceeds the configured cap — extra submitted items for an already-full slot are unfilled', async () => {
    const owner = await createUser('sub-afw-cap');
    const householdId = await createHouseholdWithOwner(owner, 'AWK234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeA = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'A' }), pool);
    const recipeB = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'B' }), pool);

    // carb caps at 1 for lunch — submitting two items for the exact same slot.
    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(
        menuId,
        false,
        [item(recipeA, 0, 'lunch', 'carb'), item(recipeB, 0, 'lunch', 'carb')],
        'sub-afw-cap',
      ),
    );

    expect(result.filledCount).toBe(1);
    expect(result.unfilledSlots).toEqual([{ dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' }]);
  });

  it('a manual addMenuItem landing between preview and commit causes the now-conflicting item to be silently skipped, reflected in filledCount/unfilledSlots', async () => {
    const owner = await createUser('sub-afw-toctou');
    const householdId = await createHouseholdWithOwner(owner, 'AWT234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeA = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'A' }), pool);
    const recipeB = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'B' }), pool);

    // Simulates a manual addMenuItem happening AFTER autoFillPreview
    // generated its proposal but BEFORE the client called autoFillWeek —
    // carb's lunch cap (1) is now already occupied by recipeB.
    const addMenuItemHandler = createAddMenuItemHandler({ getPool: async () => pool });
    await addMenuItemHandler(
      addMenuItemBuildEvent(menuId, { recipeId: recipeB, dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' }, 'sub-afw-toctou'),
    );

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, false, [item(recipeA, 0, 'lunch', 'carb')], 'sub-afw-toctou'),
    );

    expect(result.filledCount).toBe(0);
    expect(result.unfilledSlots).toEqual([{ dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' }]);
    expect(result.menu.items).toHaveLength(1); // only the manually-added one
  });

  it('a disabled meal type is never committed, even if submitted', async () => {
    const owner = await createUser('sub-afw-disabled');
    const householdId = await createHouseholdWithOwner(owner, 'AWD534');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { role: 'snack' }),
      pool,
    );
    // DEFAULT_MEALS_ENABLED = [breakfast, lunch, dinner] — snacks is disabled by default.

    const handler = createAutoFillWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, false, [item(recipeId, 0, 'snacks', 'snack')], 'sub-afw-disabled'),
    );

    expect(result.filledCount).toBe(0);
  });

  it('holds the configured cap under two genuinely concurrent autoFillWeek commits to the same slot', async () => {
    const owner = await createUser('sub-afw-concurrent-self');
    const householdId = await createHouseholdWithOwner(owner, 'AWZ234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeA = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'A' }), pool);
    const recipeB = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'B' }), pool);

    const handler = createAutoFillWeekHandler(baseDeps);
    const results = await Promise.allSettled([
      handler(buildEvent(menuId, false, [item(recipeA, 0, 'lunch', 'carb')], 'sub-afw-concurrent-self')),
      handler(buildEvent(menuId, false, [item(recipeB, 0, 'lunch', 'carb')], 'sub-afw-concurrent-self')),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const totalFilled = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof handler>>> => r.status === 'fulfilled')
      .reduce((sum, r) => sum + r.value.filledCount, 0);
    expect(totalFilled).toBe(1); // carb's cap is 1 — exactly one of the two commits

    const count = await db.adminClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menu_items WHERE menu_id = $1 AND meal_slot = 'lunch' AND slot_role = 'carb' AND day_of_week = 0`,
      [menuId],
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
  });

  it('holds the configured cap when an autoFillWeek commit races a concurrent addMenuItem for the same slot', async () => {
    const owner = await createUser('sub-afw-concurrent-addmenuitem');
    const householdId = await createHouseholdWithOwner(owner, 'AWY234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeA = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'A' }), pool);
    const recipeB = await withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'B' }), pool);

    const autoFillHandler = createAutoFillWeekHandler(baseDeps);
    const addMenuItemHandler = createAddMenuItemHandler({ getPool: async () => pool });

    const results = await Promise.allSettled([
      autoFillHandler(buildEvent(menuId, false, [item(recipeA, 0, 'lunch', 'carb')], 'sub-afw-concurrent-addmenuitem')),
      addMenuItemHandler(
        addMenuItemBuildEvent(
          menuId,
          { recipeId: recipeB, dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' },
          'sub-afw-concurrent-addmenuitem',
        ),
      ),
    ]);

    const count = await db.adminClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menu_items WHERE menu_id = $1 AND meal_slot = 'lunch' AND slot_role = 'carb' AND day_of_week = 0`,
      [menuId],
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
    // Exactly one of the two calls actually placed the item — either
    // autoFillWeek committed it (filledCount 1) or addMenuItem succeeded
    // (fulfilled), never both.
    const autoFillSucceededWithFill =
      results[0]?.status === 'fulfilled' && (results[0].value as { filledCount: number }).filledCount === 1;
    const addMenuItemSucceeded = results[1]?.status === 'fulfilled';
    expect(autoFillSucceededWithFill !== addMenuItemSucceeded).toBe(true); // exclusive-or: exactly one path won
  });
});
