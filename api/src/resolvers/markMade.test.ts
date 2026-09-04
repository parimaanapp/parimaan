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
import { createMenu as createMenuRepo, insertMenuItem as insertMenuItemRepo } from '../repositories/menuRepository.js';
import { insertRecipe, insertRecipeIngredient } from '../repositories/recipeRepository.js';
import type { InsertRecipeIngredientInput } from '../repositories/recipeRepository.js';
import { findPantryItems, insertPantryItem } from '../repositories/pantryRepository.js';
import type { PantryItemRow } from '../repositories/pantryRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createMarkMadeHandler } from './markMade.js';
import type { MarkMadeResolverDeps } from './markMade.js';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const identityFor = (cognitoSub: string | null): AppSyncResolverEvent<unknown>['identity'] =>
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
      } as unknown as AppSyncResolverEvent<unknown>['identity']);

const buildEvent = (
  menuItemId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuItemId: unknown }> => ({
  arguments: { menuItemId },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'madeAt'],
    selectionSetGraphQL: '{ id madeAt }',
    parentTypeName: 'Mutation',
    fieldName: 'markMade',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('markMade resolver (Mutation.markMade)', () => {
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

  const baseDeps: MarkMadeResolverDeps = { getPool: async () => pool };

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

  const createRecipeWithIngredients = async (
    owner: UserRow,
    householdId: string,
    servings: number,
    ingredients: readonly Omit<InsertRecipeIngredientInput, 'recipeId' | 'sortOrder'>[],
  ): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client: PoolClient) => {
        const recipe = await insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title: 'markMade test recipe',
          description: null,
          servings,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: 'sabzi_dal',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        });
        let sortOrder = 0;
        for (const ingredient of ingredients) {
          await insertRecipeIngredient(client, { ...ingredient, recipeId: recipe.id, sortOrder });
          sortOrder += 1;
        }
        return recipe.id;
      },
      pool,
    );

  const addMenuItem = async (
    owner: UserRow,
    menuId: string,
    recipeId: string,
    servingsOverride: number | null = null,
  ): Promise<string> =>
    withUserTransaction(
      owner.id,
      (client) =>
        insertMenuItemRepo(client, {
          menuId,
          recipeId,
          dayOfWeek: 0,
          mealSlot: 'dinner',
          slotRole: 'sabzi_dal',
          servingsOverride,
        }),
      pool,
    ).then((row) => row.id);

  const seedPantryItem = async (
    owner: UserRow,
    householdId: string,
    input: { name: string; quantity: number; unit: string; category?: string | null; isStaple?: boolean },
  ): Promise<PantryItemRow> =>
    withUserTransaction(
      owner.id,
      (client) =>
        insertPantryItem(client, {
          householdId,
          name: input.name,
          quantity: input.quantity,
          unit: input.unit,
          category: input.category ?? null,
          isStaple: input.isStaple ?? false,
          expiryDate: null,
          lowThreshold: null,
          addedBy: owner.id,
        }),
      pool,
    );

  const getPantryItems = async (owner: UserRow, householdId: string): Promise<PantryItemRow[]> =>
    withUserTransaction(owner.id, (client) => findPantryItems(client, householdId), pool);

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createMarkMadeHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid menuItemId', 'not-a-uuid'],
    ['absent menuItemId', undefined],
    ['explicit null menuItemId', null],
  ])('rejects a %s with ValidationError', async (_label, menuItemId) => {
    const handler = createMarkMadeHandler(baseDeps);
    await expect(handler(buildEvent(menuItemId, 'sub-mm-validation'))).rejects.toThrow(ValidationError);
  });

  it('gives a nonexistent menuItemId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-mm-oracle');
    const handler = createMarkMadeHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-mm-oracle'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-mm-oracle'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-mm-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'MKM001');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);
    await createUser('sub-mm-stranger-denial');

    const handler = createMarkMadeHandler(baseDeps);
    await expect(handler(buildEvent(menuItemId, 'sub-mm-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(menuItemId, 'sub-mm-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('sets madeAt and returns the updated MenuItem', async () => {
    const owner = await createUser('sub-mm-basic');
    const householdId = await createHouseholdWithOwner(owner, 'MKM002');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    const result = await handler(buildEvent(menuItemId, 'sub-mm-basic'));

    expect(result.id).toBe(menuItemId);
    expect(result.madeAt).toBeTruthy();
  });

  it('rejects a second markMade call on the same item with ConflictError', async () => {
    const owner = await createUser('sub-mm-twice');
    const householdId = await createHouseholdWithOwner(owner, 'MKM003');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-twice'));

    await expect(handler(buildEvent(menuItemId, 'sub-mm-twice'))).rejects.toThrow(ConflictError);
  });

  it('decrements a matched pantry row by the exact recipe quantity (exact unit match)', async () => {
    const owner = await createUser('sub-mm-exact');
    const householdId = await createHouseholdWithOwner(owner, 'MKM004');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 5, unit: 'piece' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-exact'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'onion')?.quantity).toBe(3);
  });

  it('converts and decrements across a same-family, different unit (cross-unit)', async () => {
    const owner = await createUser('sub-mm-crossunit');
    const householdId = await createHouseholdWithOwner(owner, 'MKM005');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'sugar', quantity: 1, unit: 'kg' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'sugar', quantity: 500, unit: 'g', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-crossunit'));

    const pantryItems = await getPantryItems(owner, householdId);
    const sugar = pantryItems.find((row) => row.name === 'sugar');
    expect(sugar?.unit).toBe('kg');
    expect(sugar?.quantity).toBeCloseTo(0.5, 6);
  });

  it('does NOT decrement a staple-flagged ingredient even with a real matching pantry row (O2)', async () => {
    const owner = await createUser('sub-mm-staple-flag');
    const householdId = await createHouseholdWithOwner(owner, 'MKM006');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'salt', quantity: 1, unit: 'kg' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'salt', quantity: 10, unit: 'g', category: null, notes: null, isStaple: true },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-staple-flag'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'salt')?.quantity).toBe(1);
  });

  it('a staple-category ingredient with a real pantry match is NOT decremented end-to-end (O2)', async () => {
    const owner = await createUser('sub-mm-staple-cat');
    const householdId = await createHouseholdWithOwner(owner, 'MKM007');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'cooking oil', quantity: 2, unit: 'l' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'cooking oil', quantity: 1, unit: 'l', category: 'oil', notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-staple-cat'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'cooking oil')?.quantity).toBe(2);
  });

  it('a decrement that would go negative clamps at exactly zero end-to-end (O1)', async () => {
    const owner = await createUser('sub-mm-clamp');
    const householdId = await createHouseholdWithOwner(owner, 'MKM008');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 1, unit: 'piece' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 5, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-clamp'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'onion')?.quantity).toBe(0);
  });

  it('leaves the pantry untouched and creates no row for an unmatched ingredient', async () => {
    const owner = await createUser('sub-mm-unmatched');
    const householdId = await createHouseholdWithOwner(owner, 'MKM009');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'saffron', quantity: 1, unit: 'g', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-unmatched'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(0);
  });

  it('sums two recipe ingredients that both fuzzy-match the SAME pantry row, rather than the second overwriting the first', async () => {
    const owner = await createUser('sub-mm-samerow');
    const householdId = await createHouseholdWithOwner(owner, 'MKM013');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 10, unit: 'piece' });
    // "onion" and "onions" both fuzzy-match the one seeded pantry row (D2's
    // own documented pluralization case) — the correct combined decrement
    // is 3 + 2 = 5, landing at 5, never 8 (one line's own newQuantity
    // silently overwriting the other's).
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 3, unit: 'piece', category: null, notes: null, isStaple: false },
      { name: 'onions', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-samerow'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(5);
  });

  it('scales the deduction by servingsOverride before matching', async () => {
    const owner = await createUser('sub-mm-scale');
    const householdId = await createHouseholdWithOwner(owner, 'MKM010');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 20, unit: 'piece' });
    // Recipe base servings 4, requires 2 onions -> 0.5 onion/serving.
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    // servingsOverride 8 -> scale 2x -> requires 4 onions.
    const menuItemId = await addMenuItem(owner, menuId, recipeId, 8);

    const handler = createMarkMadeHandler(baseDeps);
    await handler(buildEvent(menuItemId, 'sub-mm-scale'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'onion')?.quantity).toBe(16);
  });

  it('the madeAt write and every pantry decrement are atomic — a forced failure on applyDeductionLines leaves neither side changed', async () => {
    const owner = await createUser('sub-mm-atomic-fail1');
    const householdId = await createHouseholdWithOwner(owner, 'MKM011');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 5, unit: 'piece' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const failingApplyDeductionLines: MarkMadeResolverDeps['applyDeductionLines'] = async () => {
      throw new Error('simulated failure applying pantry deduction');
    };
    const handler = createMarkMadeHandler({ ...baseDeps, applyDeductionLines: failingApplyDeductionLines });

    await expect(handler(buildEvent(menuItemId, 'sub-mm-atomic-fail1'))).rejects.toThrow(
      'simulated failure applying pantry deduction',
    );

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'onion')?.quantity).toBe(5);

    // Re-run for real: would throw CONFLICT if the failed attempt had
    // somehow already stamped madeAt.
    const handler2 = createMarkMadeHandler(baseDeps);
    const result = await handler2(buildEvent(menuItemId, 'sub-mm-atomic-fail1'));
    expect(result.madeAt).toBeTruthy();
  });

  it('the madeAt write and every pantry decrement are atomic — a forced failure on setMenuItemMadeAt rolls back the pantry write too', async () => {
    const owner = await createUser('sub-mm-atomic-fail2');
    const householdId = await createHouseholdWithOwner(owner, 'MKM012');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 5, unit: 'piece' });
    const recipeId = await createRecipeWithIngredients(owner, householdId, 4, [
      { name: 'onion', quantity: 2, unit: 'piece', category: null, notes: null, isStaple: false },
    ]);
    const menuItemId = await addMenuItem(owner, menuId, recipeId);

    const failingSetMenuItemMadeAt: MarkMadeResolverDeps['setMenuItemMadeAt'] = async () => {
      throw new Error('simulated failure stamping madeAt');
    };
    const handler = createMarkMadeHandler({ ...baseDeps, setMenuItemMadeAt: failingSetMenuItemMadeAt });

    await expect(handler(buildEvent(menuItemId, 'sub-mm-atomic-fail2'))).rejects.toThrow(
      'simulated failure stamping madeAt',
    );

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems.find((row) => row.name === 'onion')?.quantity).toBe(5);
  });
});
