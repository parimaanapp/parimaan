import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { syncCatalog } from '../catalog/syncCatalog.js';
import type { CatalogBundle } from '../catalog/buildBundle.js';
import { resetCatalogCacheForTesting } from '../repositories/catalogRepository.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createMenu as createMenuRepo } from '../repositories/menuRepository.js';
import { findPantryItems, insertPantryItem } from '../repositories/pantryRepository.js';
import { findRecipeIngredientsByRecipeId, insertRecipe, insertRecipeIngredient } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createCreateRecipeHandler } from './createRecipe.js';
import { createUpdateRecipeHandler } from './updateRecipe.js';
import { createAddPantryItemHandler } from './addPantryItem.js';
import { createBulkAddPantryItemsHandler } from './bulkAddPantryItems.js';
import { createUpdatePantryItemHandler } from './updatePantryItem.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import { createGenerateShoppingListHandler } from './generateShoppingList.js';

const entry = (
  id: string,
  canonicalName: string,
  allowedUnits: string[],
  aliases: string[] = [],
): CatalogBundle['ingredients'][number] => ({
  id,
  canonicalName,
  appCategory: 'produce',
  subcategory: 'veg',
  allowedUnits,
  defaultUnit: allowedUnits[0] ?? 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases,
});

const BUNDLE: CatalogBundle = {
  ingredients: [
    entry('onion', 'Onion', ['g', 'kg', 'piece'], ['pyaz', 'kanda']),
    entry('basmati_rice', 'Basmati Rice', ['g', 'kg'], ['chawal']),
    entry('salt', 'Salt', ['g', 'tsp'], ['namak']),
    entry('pumpkin_seeds', 'Pumpkin Seeds', ['g'], ['magaz']),
    entry('watermelon_seeds', 'Watermelon Seeds', ['g'], ['magaz']),
  ],
  conversions: [
    { scope: 'ingredient', key: 'basmati_rice', unit: 'cup', baseUnit: 'g', amount: 190 },
    { scope: 'ingredient', key: 'onion', unit: 'piece', baseUnit: 'g', amount: 110 },
  ],
};

const identity = (sub: string): AppSyncResolverEvent<unknown>['identity'] =>
  ({
    sub,
    issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
    username: sub,
    claims: { email: `${sub}@example.test` },
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
  }) as unknown as AppSyncResolverEvent<unknown>['identity'];

const event = <T>(args: T, sub: string, fieldName: string): AppSyncResolverEvent<T> => ({
  arguments: args,
  identity: identity(sub),
  source: null,
  request: { headers: {}, domainName: null },
  info: { selectionSetList: ['id'], selectionSetGraphQL: '{ id }', parentTypeName: 'Mutation', fieldName, variables: {} },
  prev: null,
  stash: {},
});

describe('canonicalise on write (B2b)', () => {
  let db: TestDatabase;
  let pool: Pool;
  // The caller-user lookup is cached per cognito sub, so every test gets its own.
  let SUB = '';
  let counter = 0;
  let owner: UserRow;
  let householdId: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
    await syncCatalog(db.adminClient, BUNDLE);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  beforeEach(async () => {
    resetCatalogCacheForTesting();
    counter += 1;
    SUB = `sub-b2b-${counter}`;
    const client = await pool.connect();
    try {
      owner = await upsertUserByCognitoSub(client, {
        cognitoSub: SUB,
        email: `${SUB}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
    householdId = await withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, { name: 'B2b', inviteCode: 'B2B234', primaryUserId: owner.id });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        return household.id;
      },
      pool,
    );
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const deps = { getPool: async (): Promise<Pool> => pool };

  const ingredientsOf = (recipeId: string) =>
    withUserTransaction(owner.id, (client) => findRecipeIngredientsByRecipeId(client, recipeId), pool);
  const pantryOf = () => withUserTransaction(owner.id, (client) => findPantryItems(client, householdId), pool);

  const createRecipe = async (ingredients: unknown[]): Promise<string> => {
    const result = await createCreateRecipeHandler(deps)(
      event(
        { householdId, input: { title: 'Pulao', role: 'carb', ingredients, steps: [] } },
        SUB,
        'createRecipe',
      ),
    );
    return result.id;
  };

  it('createRecipe stores canonical name and id, flags the rest, and keeps staples', async () => {
    const recipeId = await createRecipe([
      { name: 'Pyaz (finely chopped)', quantity: 2, unit: 'piece' },
      { name: 'Dragon Fruit Jam', quantity: 1, unit: 'jar' },
      { name: 'magaz', quantity: 10, unit: 'g' },
      { name: 'namak', quantity: 1, unit: 'tsp', isStaple: true, category: 'spice' },
      { name: 'chawal', quantity: 1.5, unit: 'cup' },
    ]);

    const rows = await ingredientsOf(recipeId);
    expect(rows.map((row) => [row.name, row.ingredientId, row.catalogMatch])).toEqual([
      ['Onion', 'onion', 'resolved'],
      ['Dragon Fruit Jam', null, 'unresolved'],
      ['magaz', null, 'ambiguous'],
      ['Salt', 'salt', 'resolved'],
      ['Basmati Rice', 'basmati_rice', 'resolved'],
    ]);
    expect(rows[0]).toMatchObject({ notes: 'finely chopped', quantity: 2, unit: 'piece' });
    expect(rows[3]).toMatchObject({ isStaple: true, category: 'spice' });
    // 1.5 cup is not an allowed unit for rice; the catalog defines cup -> g, original recorded.
    expect(rows[4]).toMatchObject({ quantity: 285, unit: 'g', notes: '1.5 cup' });
  });

  it('updateRecipe re-canonicalises a replaced ingredient list', async () => {
    const recipeId = await createRecipe([{ name: 'Dragon Fruit Jam', quantity: 1, unit: 'jar' }]);
    await createUpdateRecipeHandler(deps)(
      event({ id: recipeId, input: { ingredients: [{ name: 'kanda', quantity: 3, unit: 'piece' }] } }, SUB, 'updateRecipe'),
    );
    const rows = await ingredientsOf(recipeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Onion', ingredientId: 'onion', catalogMatch: 'resolved' });
  });

  it('addPantryItem and bulkAddPantryItems store canonical names and ids', async () => {
    await createAddPantryItemHandler(deps)(
      event({ householdId, input: { name: 'kanda', quantity: 3, unit: 'piece' } }, SUB, 'addPantryItem'),
    );
    await createBulkAddPantryItemsHandler(deps)(
      event(
        {
          householdId,
          items: [
            { name: 'Chawal', quantity: 1, unit: 'kg' },
            { name: 'Mystery Powder', quantity: 1, unit: 'packet' },
          ],
        },
        SUB,
        'bulkAddPantryItems',
      ),
    );
    const rows = await pantryOf();
    expect(rows.map((row) => [row.name, row.ingredientId, row.catalogMatch]).sort()).toEqual([
      ['Basmati Rice', 'basmati_rice', 'resolved'],
      ['Mystery Powder', null, 'unresolved'],
      ['Onion', 'onion', 'resolved'],
    ]);
  });

  it('updatePantryItem re-resolves on rename and clears the id for an unresolved name', async () => {
    const added = await createAddPantryItemHandler(deps)(
      event({ householdId, input: { name: 'Onion', quantity: 3, unit: 'piece' } }, SUB, 'addPantryItem'),
    );
    const renamed = await createUpdatePantryItemHandler(deps)(
      event({ id: added.id, input: { name: 'Mystery Powder' } }, SUB, 'updatePantryItem'),
    );
    expect(renamed.name).toBe('Mystery Powder');
    expect((await pantryOf())[0]).toMatchObject({ ingredientId: null, catalogMatch: 'unresolved' });

    await createUpdatePantryItemHandler(deps)(
      event({ id: added.id, input: { quantity: 5 } }, SUB, 'updatePantryItem'),
    );
    expect((await pantryOf())[0]).toMatchObject({ ingredientId: null, catalogMatch: 'unresolved', quantity: 5 });
  });

  it('a save still succeeds, unchanged and unflagged, when the catalog is empty', async () => {
    await db.adminClient.query('DELETE FROM ingredient_catalog');
    await db.adminClient.query('DELETE FROM catalog_sync_state');
    resetCatalogCacheForTesting();
    try {
      const recipeId = await createRecipe([{ name: 'Pyaz', quantity: 2, unit: 'piece' }]);
      const rows = await ingredientsOf(recipeId);
      expect(rows[0]).toMatchObject({ name: 'Pyaz', ingredientId: null, catalogMatch: null });
    } finally {
      await syncCatalog(db.adminClient, BUNDLE);
      resetCatalogCacheForTesting();
    }
  });

  describe('stale catalog cache (an ingredient deleted by a sync)', () => {
    const warmCacheThenDeleteOnion = async (): Promise<void> => {
      // Prime the module cache, then let a "sync" delete the ingredient behind its back.
      await createRecipe([{ name: 'Pyaz', quantity: 1, unit: 'piece' }]);
      await db.adminClient.query(`DELETE FROM ingredient_catalog WHERE id = 'onion'`);
    };
    const restoreCatalog = async (): Promise<void> => {
      await db.adminClient.query('DELETE FROM catalog_sync_state');
      await syncCatalog(db.adminClient, BUNDLE);
      resetCatalogCacheForTesting();
    };

    it('createRecipe falls back to a null id instead of failing on the FK', async () => {
      await warmCacheThenDeleteOnion();
      try {
        const recipeId = await createRecipe([
          { name: 'Pyaz', quantity: 2, unit: 'piece' },
          { name: 'namak', quantity: 1, unit: 'tsp' },
        ]);
        const rows = await ingredientsOf(recipeId);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ ingredientId: null, catalogMatch: null });
        expect(rows[1]).toMatchObject({ ingredientId: 'salt', catalogMatch: 'resolved' });
      } finally {
        await restoreCatalog();
      }
    });

    it('pantry adds fall back the same way', async () => {
      await warmCacheThenDeleteOnion();
      try {
        await createAddPantryItemHandler(deps)(
          event({ householdId, input: { name: 'kanda', quantity: 3, unit: 'piece' } }, SUB, 'addPantryItem'),
        );
        await createBulkAddPantryItemsHandler(deps)(
          event({ householdId, items: [{ name: 'pyaz', quantity: 1, unit: 'kg' }] }, SUB, 'bulkAddPantryItems'),
        );
        const rows = await pantryOf();
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.ingredientId === null && row.catalogMatch === null)).toBe(true);
      } finally {
        await restoreCatalog();
      }
    });

    it('a rename to a deleted ingredient falls back too', async () => {
      const added = await createAddPantryItemHandler(deps)(
        event({ householdId, input: { name: 'Mystery', quantity: 1, unit: 'kg' } }, SUB, 'addPantryItem'),
      );
      await warmCacheThenDeleteOnion();
      try {
        const renamed = await createUpdatePantryItemHandler(deps)(
          event({ id: added.id, input: { name: 'pyaz' } }, SUB, 'updatePantryItem'),
        );
        expect(renamed.name).toBe('Onion');
        expect((await pantryOf())[0]).toMatchObject({ ingredientId: null, catalogMatch: null });
      } finally {
        await restoreCatalog();
      }
    });
  });

  describe('shopping list', () => {
    const seed = async (client: PoolClient): Promise<{ recipeId: string; recipe2Id: string }> => {
      const make = async (title: string): Promise<string> =>
        (
          await insertRecipe(client, {
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
            createdBy: owner.id,
          })
        ).id;
      const recipeId = await make('A');
      const recipe2Id = await make('B');
      const line = (recipe: string, name: string, quantity: number, unit: string, id: string | null, order: number) =>
        insertRecipeIngredient(client, {
          recipeId: recipe,
          name,
          quantity,
          unit,
          category: null,
          notes: null,
          isStaple: false,
          sortOrder: order,
          ingredientId: id,
          catalogMatch: id === null ? null : 'resolved',
        });
      await line(recipeId, 'Basmati Rice', 1, 'cup', 'basmati_rice', 0);
      await line(recipe2Id, 'Rice (basmati)', 190, 'g', 'basmati_rice', 0);
      await line(recipeId, 'Onion', 5, 'piece', 'onion', 1);
      return { recipeId, recipe2Id };
    };

    it('merges across units by id and subtracts the pantry by id', async () => {
      const menu = await withUserTransaction(owner.id, (client) => createMenuRepo(client, householdId, '2026-09-07T00:00:00.000Z'), pool);
      const ids = await withUserTransaction(
        owner.id,
        async (client) => {
          const seeded = await seed(client);
          await insertPantryItem(client, {
            householdId,
            name: 'Kanda',
            quantity: 3,
            unit: 'piece',
            category: null,
            isStaple: false,
            expiryDate: null,
            lowThreshold: null,
            addedBy: owner.id,
            ingredientId: 'onion',
            catalogMatch: 'resolved',
          });
          return seeded;
        },
        pool,
      );
      const addItem = createAddMenuItemHandler(deps);
      await addItem(event({ menuId: menu.id, input: { recipeId: ids.recipeId, dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb' } }, SUB, 'addMenuItem'));
      await addItem(event({ menuId: menu.id, input: { recipeId: ids.recipe2Id, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'carb' } }, SUB, 'addMenuItem'));

      const list = await createGenerateShoppingListHandler({ ...deps, invokeStaplesNoteFn: async () => undefined })(event({ menuId: menu.id }, SUB, 'generateShoppingList'));

      const rice = list.items.filter((item) => item.name === 'Basmati Rice');
      expect(rice).toHaveLength(1);
      expect(rice[0]).toMatchObject({ quantity: 2, unit: 'cup' });
      const onion = list.items.find((item) => item.name === 'Onion');
      expect(onion).toMatchObject({ quantity: 2, unit: 'piece' });
    });
  });
});
