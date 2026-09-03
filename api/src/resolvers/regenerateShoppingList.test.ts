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
import type { UserRow } from '../repositories/userRepository.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import { createGenerateShoppingListHandler } from './generateShoppingList.js';
import { createRegenerateShoppingListHandler } from './regenerateShoppingList.js';
import type { RegenerateShoppingListResolverDeps } from './regenerateShoppingList.js';
import { findShoppingListByMenu, findShoppingListItems } from '../repositories/shoppingListRepository.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

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
  confirmed: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown; confirmed: unknown }> => ({
  arguments: { menuId, confirmed },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'items'],
    selectionSetGraphQL: '{ id items { id name purchased } }',
    parentTypeName: 'Mutation',
    fieldName: 'regenerateShoppingList',
    variables: {},
  },
  prev: null,
  stash: {},
});

const generateEvent = (
  menuId: unknown,
  cognitoSub: string,
): AppSyncResolverEvent<{ menuId: unknown }> => ({
  arguments: { menuId },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'items'],
    selectionSetGraphQL: '{ id items { id } }',
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

describe('regenerateShoppingList resolver (Mutation.regenerateShoppingList)', () => {
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

  const baseDeps: RegenerateShoppingListResolverDeps = { getPool: async () => pool };

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
    ingredients: readonly { name: string; quantity: number | null; unit: string | null }[],
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
        category: null,
        notes: null,
        isStaple: false,
        sortOrder: index,
      });
    }
    return recipe.id;
  };

  const placeItem = async (menuId: string, recipeId: string, dayOfWeek: number, ownerSub: string): Promise<void> => {
    const handler = createAddMenuItemHandler({ getPool: async () => pool });
    await handler(addMenuItemBuildEvent(menuId, { recipeId, dayOfWeek, mealSlot: 'lunch', slotRole: 'carb' }, ownerSub));
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-rsl-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'RSL001');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createRegenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, true, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['explicit null menuId', null, true],
    ['explicit null confirmed (non-nullable, must be rejected)', randomUUID(), null],
    ['absent confirmed', randomUUID(), undefined],
  ])('rejects %s with ValidationError', async (_label, menuId, confirmed) => {
    const handler = createRegenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, confirmed, 'sub-rsl-validation'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-rsl-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'RSL002');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-rsl-stranger-denial');

    const handler = createRegenerateShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, true, 'sub-rsl-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(menuId, true, 'sub-rsl-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('confirmed:true with no prior list behaves identically to a first generateShoppingList call', async () => {
    const owner = await createUser('sub-rsl-noprior');
    const householdId = await createHouseholdWithOwner(owner, 'RSL003');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const client = await pool.connect();
    let recipeId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      recipeId = await addRecipeWithIngredients(client, householdId, owner.id, 'Poha', [
        { name: 'flattened rice', quantity: 250, unit: 'g' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await placeItem(menuId, recipeId, 0, 'sub-rsl-noprior');

    const handler = createRegenerateShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, true, 'sub-rsl-noprior'));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name.toLowerCase()).toBe('flattened rice');
    expect(result.items[0]?.quantity).toBe(250);

    // And it actually persisted — a real generateShoppingList call afterward
    // for this same menu now sees a conflict, exactly as if it had been
    // created by generateShoppingList itself.
    const persisted = await withUserTransaction(owner.id, (c) => findShoppingListByMenu(c, menuId), pool);
    expect(persisted?.id).toBe(result.id);
  });

  it('confirmed:false previews (writes nothing) and reports accurate counts of what would be replaced', async () => {
    const owner = await createUser('sub-rsl-preview');
    const householdId = await createHouseholdWithOwner(owner, 'RSL004');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const client = await pool.connect();
    let recipeId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      recipeId = await addRecipeWithIngredients(client, householdId, owner.id, 'Upma', [
        { name: 'semolina', quantity: 200, unit: 'g' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await placeItem(menuId, recipeId, 0, 'sub-rsl-preview');

    const generateHandler = createGenerateShoppingListHandler({ getPool: async () => pool });
    await generateHandler(generateEvent(menuId, 'sub-rsl-preview'));

    const regenerateHandler = createRegenerateShoppingListHandler(baseDeps);
    const preview = await regenerateHandler(buildEvent(menuId, false, 'sub-rsl-preview'));

    // One auto-generated, not-yet-had item would be replaced.
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]?.purchased).toBe(false);

    // Nothing was actually written — the real list still has its original item id.
    const persisted = await withUserTransaction(owner.id, (c) => findShoppingListByMenu(c, menuId), pool);
    expect(persisted).not.toBeNull();
    const persistedItems = await withUserTransaction(
      owner.id,
      (c) => findShoppingListItems(c, persisted!.id),
      pool,
    );
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0]?.id).not.toBe(preview.items[0]?.id);
  });

  it('confirmed:true preserves already-purchased/movedToPantry items byte-identical, recomputing only the rest', async () => {
    const owner = await createUser('sub-rsl-preserve');
    const householdId = await createHouseholdWithOwner(owner, 'RSL005');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const client = await pool.connect();
    let recipeId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      recipeId = await addRecipeWithIngredients(client, householdId, owner.id, 'Khichdi', [
        { name: 'moong dal', quantity: 300, unit: 'g' },
        { name: 'rice', quantity: 400, unit: 'g' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await placeItem(menuId, recipeId, 0, 'sub-rsl-preserve');

    const generateHandler = createGenerateShoppingListHandler({ getPool: async () => pool });
    const generated = await generateHandler(generateEvent(menuId, 'sub-rsl-preserve'));
    const dalItem = generated.items.find((entry) => entry.name.toLowerCase() === 'moong dal');
    expect(dalItem).toBeDefined();

    // Mark the "moong dal" line as already-had, directly via SQL (S3's
    // `haveIt` doesn't exist yet this slice) — the same "seeded directly,
    // bypassing the not-yet-built resolver" approach D8's own RED test
    // list calls for.
    const markClient = await pool.connect();
    try {
      await markClient.query('BEGIN');
      await markClient.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      await markClient.query(
        `UPDATE shopping_list_items SET purchased = TRUE, moved_to_pantry = TRUE, purchased_by = $1, purchased_at = NOW() WHERE id = $2`,
        [owner.id, dalItem!.id],
      );
      await markClient.query('COMMIT');
    } catch (error) {
      await markClient.query('ROLLBACK');
      throw error;
    } finally {
      markClient.release();
    }

    // Change the menu's own recipe requirement for "rice" before regenerating.
    const bumpClient = await pool.connect();
    try {
      await bumpClient.query('BEGIN');
      await bumpClient.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      await bumpClient.query(`UPDATE recipe_ingredients SET quantity = 800 WHERE recipe_id = $1 AND name = 'rice'`, [
        recipeId,
      ]);
      await bumpClient.query('COMMIT');
    } catch (error) {
      await bumpClient.query('ROLLBACK');
      throw error;
    } finally {
      bumpClient.release();
    }

    const regenerateHandler = createRegenerateShoppingListHandler(baseDeps);
    const result = await regenerateHandler(buildEvent(menuId, true, 'sub-rsl-preserve'));

    const preservedDal = result.items.find((entry) => entry.id === dalItem!.id);
    expect(preservedDal).toBeDefined();
    expect(preservedDal?.purchased).toBe(true);
    expect(preservedDal?.movedToPantry).toBe(true);
    expect(preservedDal?.quantity).toBe(300);

    const riceLine = result.items.find((entry) => entry.name.toLowerCase() === 'rice');
    expect(riceLine).toBeDefined();
    expect(riceLine?.quantity).toBe(800);
    expect(riceLine?.id).not.toBe(
      generated.items.find((entry) => entry.name.toLowerCase() === 'rice')?.id,
    );
  });

  it('confirmed:true preserves a manually-added item (sourceRecipeId null), seeded directly via the repository', async () => {
    const owner = await createUser('sub-rsl-manual');
    const householdId = await createHouseholdWithOwner(owner, 'RSL006');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const client = await pool.connect();
    let recipeId = '';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      recipeId = await addRecipeWithIngredients(client, householdId, owner.id, 'Paratha', [
        { name: 'wheat flour', quantity: 500, unit: 'g' },
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await placeItem(menuId, recipeId, 0, 'sub-rsl-manual');

    const generateHandler = createGenerateShoppingListHandler({ getPool: async () => pool });
    const generated = await generateHandler(generateEvent(menuId, 'sub-rsl-manual'));

    // Seed a manually-added item directly (addShoppingListItem isn't built
    // this week — D8's own accounted-for gap).
    let manualItemId = '';
    const seedClient = await pool.connect();
    try {
      await seedClient.query('BEGIN');
      await seedClient.query(`SELECT set_config('parimaan.user_id', $1, true)`, [owner.id]);
      const inserted = await seedClient.query<{ id: string }>(
        `INSERT INTO shopping_list_items (shopping_list_id, name, quantity, unit, category, source_recipe_id)
         VALUES ($1, $2, $3, $4, $5, NULL) RETURNING id`,
        [generated.id, 'paper towels', 1, 'packet', null],
      );
      manualItemId = inserted.rows[0]!.id;
      await seedClient.query('COMMIT');
    } catch (error) {
      await seedClient.query('ROLLBACK');
      throw error;
    } finally {
      seedClient.release();
    }

    const regenerateHandler = createRegenerateShoppingListHandler(baseDeps);
    const result = await regenerateHandler(buildEvent(menuId, true, 'sub-rsl-manual'));

    const preservedManual = result.items.find((entry) => entry.id === manualItemId);
    expect(preservedManual).toBeDefined();
    expect(preservedManual?.name).toBe('paper towels');
    expect(preservedManual?.sourceRecipeId).toBeNull();
  });
});
