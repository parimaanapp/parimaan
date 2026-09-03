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
import { insertRecipe, insertRecipeIngredient } from '../repositories/recipeRepository.js';
import { insertPantryItem } from '../repositories/pantryRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import { createGenerateShoppingListHandler } from './generateShoppingList.js';
import type { GenerateShoppingListResolverDeps } from './generateShoppingList.js';
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
  menuId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown }> => ({
  arguments: { menuId },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'items'],
    selectionSetGraphQL: '{ id items { id name } }',
    parentTypeName: 'Mutation',
    fieldName: 'generateShoppingList',
    variables: {},
  },
  prev: null,
  stash: {},
});

const addMenuItemBuildEvent = (
  menuId: unknown,
  input: unknown,
  cognitoSub: string,
): AppSyncResolverEvent<{ menuId: unknown; input: unknown }> => ({
  arguments: { menuId, input },
  identity: identityFor(cognitoSub),
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

describe('generateShoppingList resolver (Mutation.generateShoppingList)', () => {
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

  const baseDeps: GenerateShoppingListResolverDeps = { getPool: async () => pool };

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

  const addRecipeWithIngredients = async (
    client: PoolClient,
    householdId: string,
    createdBy: string,
    title: string,
    ingredients: readonly {
      name: string;
      quantity: number | null;
      unit: string | null;
      category?: string | null;
      isStaple?: boolean;
    }[],
  ): Promise<string> => {
    const recipe = await insertRecipe(client, {
      householdId,
      sourceType: 'user',
      sourceUrl: null,
      title,
      description: null,
      servings: 4,
      prepMin: null,
      cookMin: null,
      cuisineTier1: null,
      cuisineTier2: null,
      dietaryTags: [],
      role: 'carb',
      inRotation: true,
      steps: [],
      createdBy,
    });
    for (const [index, ingredient] of ingredients.entries()) {
      await insertRecipeIngredient(client, {
        recipeId: recipe.id,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        category: ingredient.category ?? null,
        notes: null,
        isStaple: ingredient.isStaple ?? false,
        sortOrder: index,
      });
    }
    return recipe.id;
  };

  const placeItem = async (
    menuId: string,
    recipeId: string,
    dayOfWeek: number,
    ownerSub: string,
  ): Promise<void> => {
    const handler = createAddMenuItemHandler({ getPool: async () => pool });
    const result = await handler(
      addMenuItemBuildEvent(
        menuId,
        { recipeId, dayOfWeek, mealSlot: 'lunch', slotRole: 'carb' },
        ownerSub,
      ),
    );
    expect(result.id).toBeTruthy();
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-gsl-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'GSL001');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createGenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['explicit null', null],
  ])('rejects a %s menuId with ValidationError', async (_label, menuId) => {
    const handler = createGenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 'sub-gsl-validation'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-gsl-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'GSL002');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-gsl-stranger-denial');

    const handler = createGenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 'sub-gsl-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(menuId, 'sub-gsl-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-gsl-oracle');
    const handler = createGenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-gsl-oracle'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-gsl-oracle'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('generates an empty list (never an error) for a menu with no items', async () => {
    const owner = await createUser('sub-gsl-empty');
    const householdId = await createHouseholdWithOwner(owner, 'GSL003');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createGenerateShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-gsl-empty'));

    expect(result.items).toEqual([]);
    expect(result.householdId).toBe(householdId);
    expect(result.generatedFromMenuId).toBe(menuId);
  });

  it('generates a list matching S1 aggregation invariants for a full week of items', async () => {
    const owner = await createUser('sub-gsl-fullweek');
    const householdId = await createHouseholdWithOwner(owner, 'GSL004');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const client = await pool.connect();
    let recipeAId = '';
    let recipeBId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      recipeAId = await addRecipeWithIngredients(client, householdId, owner.id, 'Rajma', [
        { name: 'onion', quantity: 2, unit: 'piece' },
        { name: 'salt', quantity: 1, unit: 'tsp', category: 'spice' },
      ]);
      recipeBId = await addRecipeWithIngredients(client, householdId, owner.id, 'Chole', [
        { name: 'onions', quantity: 1, unit: 'piece' },
        { name: 'rajma', quantity: 200, unit: 'g' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await placeItem(menuId, recipeAId, 0, 'sub-gsl-fullweek');
    await placeItem(menuId, recipeBId, 1, 'sub-gsl-fullweek');

    const handler = createGenerateShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-gsl-fullweek'));

    // "salt" is staple-excluded (unit tsp AND category spice), never appears.
    expect(result.items.some((entry) => entry.name.toLowerCase() === 'salt')).toBe(false);
    // "onion"/"onions" fuzzy-merge (D2) into one line summing to 3 piece.
    const onionLine = result.items.find((entry) => entry.name.toLowerCase().startsWith('onion'));
    expect(onionLine).toBeDefined();
    expect(onionLine?.quantity).toBe(3);
    expect(onionLine?.unit).toBe('piece');
    // "rajma" the ingredient appears, at full quantity (no pantry stock yet).
    const rajmaLine = result.items.find((entry) => entry.name.toLowerCase() === 'rajma');
    expect(rajmaLine?.quantity).toBe(200);
    expect(rajmaLine?.sourceRecipeId).toBe(recipeBId);
  });

  it('subtracts current pantry stock before writing the list', async () => {
    const owner = await createUser('sub-gsl-pantry');
    const householdId = await createHouseholdWithOwner(owner, 'GSL005');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const client = await pool.connect();
    let recipeId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      recipeId = await addRecipeWithIngredients(client, householdId, owner.id, 'Dal', [
        { name: 'toor dal', quantity: 500, unit: 'g' },
      ]);
      await insertPantryItem(client, {
        householdId,
        name: 'toor dal',
        quantity: 200,
        unit: 'g',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await placeItem(menuId, recipeId, 0, 'sub-gsl-pantry');

    const handler = createGenerateShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-gsl-pantry'));

    const dalLine = result.items.find((entry) => entry.name.toLowerCase() === 'toor dal');
    expect(dalLine?.quantity).toBe(300);
  });

  it('never lets a recipe from another household contribute ingredients', async () => {
    const owner = await createUser('sub-gsl-cross-owner');
    const householdId = await createHouseholdWithOwner(owner, 'GSL006');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const otherOwner = await createUser('sub-gsl-cross-other');
    const otherHouseholdId = await createHouseholdWithOwner(otherOwner, 'GSL007');

    const client = await pool.connect();
    let ownRecipeId = '';
    let otherRecipeId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      ownRecipeId = await addRecipeWithIngredients(client, householdId, owner.id, 'Own Recipe', [
        { name: 'ginger', quantity: 1, unit: 'piece' },
      ]);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [otherOwner.id]);
      otherRecipeId = await addRecipeWithIngredients(client, otherHouseholdId, otherOwner.id, 'Other Recipe', [
        { name: 'cross-household ingredient', quantity: 1, unit: 'piece' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    void otherRecipeId;

    await placeItem(menuId, ownRecipeId, 0, 'sub-gsl-cross-owner');

    // Directly seed a menu_items row pointing at the other household's
    // recipe — bypassing `addMenuItem`'s own cross-household equality
    // check, to prove RLS (not app-layer trust) is what protects
    // `generateShoppingList` here.
    const seedClient = await pool.connect();
    try {
      await seedClient.query('BEGIN');
      await seedClient.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      await seedClient.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, $3, $4, $5)`,
        [menuId, otherRecipeId, 2, 'lunch', 'carb'],
      );
      await seedClient.query('COMMIT');
    } catch {
      await seedClient.query('ROLLBACK');
    } finally {
      seedClient.release();
    }

    const handler = createGenerateShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-gsl-cross-owner'));

    expect(result.items.some((entry) => entry.name.includes('cross-household'))).toBe(false);
    expect(result.items.some((entry) => entry.name.toLowerCase() === 'ginger')).toBe(true);
  });

  it('refuses a second call while an open list already exists for this menu', async () => {
    const owner = await createUser('sub-gsl-conflict');
    const householdId = await createHouseholdWithOwner(owner, 'GSL008');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createGenerateShoppingListHandler(baseDeps);
    await handler(buildEvent(menuId, 'sub-gsl-conflict'));

    await expect(handler(buildEvent(menuId, 'sub-gsl-conflict'))).rejects.toThrow(ConflictError);
  });
});
