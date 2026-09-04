import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { insertRecipe } from '../repositories/recipeRepository.js';
import { findPantryItems, insertPantryItem } from '../repositories/pantryRepository.js';
import type { PantryItemRow } from '../repositories/pantryRepository.js';
import { insertShoppingList, insertShoppingListItems } from '../repositories/shoppingListRepository.js';
import type { NewShoppingListItemInput } from '../repositories/shoppingListRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createMarkPurchasedHandler } from './markPurchased.js';
import type { MarkPurchasedResolverDeps } from './markPurchased.js';
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
  itemId: unknown,
  cognitoSub: string | null,
  // Extra arguments (e.g. a stray `quantity`) are simulated here to prove
  // D5's "no quantity argument" contract server-side: even if a stale
  // client sends one, the validation schema strips it and the resolver
  // never reads it.
  extraArguments: Record<string, unknown> = {},
): AppSyncResolverEvent<{ itemId: unknown }> => ({
  arguments: { itemId, ...extraArguments },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'items'],
    selectionSetGraphQL: '{ id items { id purchased movedToPantry } }',
    parentTypeName: 'Mutation',
    fieldName: 'markPurchased',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('markPurchased resolver (Mutation.markPurchased)', () => {
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

  const baseDeps: MarkPurchasedResolverDeps = { getPool: async () => pool };

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

  /** A bare recipe row purely to satisfy `shopping_list_items.source_recipe_id`'s FK — no ingredients needed for these tests. */
  const seedRecipeId = async (owner: UserRow, householdId: string): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const recipe = await insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title: 'markPurchased test recipe',
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
        });
        return recipe.id;
      },
      pool,
    );

  /** Seeds a fresh shopping list (no menu) with exactly `items`, directly via the repository. Returns the inserted row's id. */
  const seedShoppingListItem = async (
    owner: UserRow,
    householdId: string,
    item: Omit<NewShoppingListItemInput, 'sourceRecipeId'>,
  ): Promise<string> => {
    const sourceRecipeId = await seedRecipeId(owner, householdId);
    return withUserTransaction(
      owner.id,
      async (client) => {
        const list = await insertShoppingList(client, { householdId, generatedFromMenuId: null });
        const [row] = await insertShoppingListItems(client, list.id, [{ ...item, sourceRecipeId }]);
        return row!.id;
      },
      pool,
    );
  };

  const seedPantryItem = async (
    owner: UserRow,
    householdId: string,
    input: { name: string; quantity: number; unit: string; category?: string | null; expiryDate?: string | null },
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
          isStaple: false,
          expiryDate: input.expiryDate ?? null,
          lowThreshold: null,
          addedBy: owner.id,
        }),
      pool,
    );

  const getPantryItems = async (owner: UserRow, householdId: string): Promise<PantryItemRow[]> =>
    withUserTransaction(owner.id, (client) => findPantryItems(client, householdId), pool);

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createMarkPurchasedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid itemId', 'not-a-uuid'],
    ['absent itemId', undefined],
    ['explicit null itemId', null],
  ])('rejects a %s with ValidationError', async (_label, itemId) => {
    const handler = createMarkPurchasedHandler(baseDeps);
    await expect(handler(buildEvent(itemId, 'sub-mp-validation'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-mp-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'MPU001');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'toor dal',
      quantity: 500,
      unit: 'g',
      category: 'dal',
    });
    await createUser('sub-mp-stranger-denial');

    const handler = createMarkPurchasedHandler(baseDeps);
    await expect(handler(buildEvent(itemId, 'sub-mp-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(itemId, 'sub-mp-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent itemId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-mp-oracle');
    const handler = createMarkPurchasedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-mp-oracle'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-mp-oracle'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('creates a fresh pantry row at the category-default expiry (O3) when no matching row exists', async () => {
    const owner = await createUser('sub-mp-newrow-expiry');
    const householdId = await createHouseholdWithOwner(owner, 'MPU002');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'milk',
      quantity: 1,
      unit: 'liter',
      category: 'dairy',
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    const result = await handler(buildEvent(itemId, 'sub-mp-newrow-expiry'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.name).toBe('milk');
    expect(pantryItems[0]?.quantity).toBe(1);

    // dairy's locked default is 5 days (O3, defaultExpiry.ts) — assert a
    // real, non-null YYYY-MM-DD date was set, not the exact day (avoids a
    // flaky assertion on the precise instant `now()` ran).
    expect(pantryItems[0]?.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const markedItem = result.items.find((entry) => entry.id === itemId);
    expect(markedItem?.purchased).toBe(true);
    expect(markedItem?.movedToPantry).toBe(true);
  });

  it('creates a fresh pantry row with a null expiry for an uncategorized ("other") item', async () => {
    const owner = await createUser('sub-mp-newrow-noexpiry');
    const householdId = await createHouseholdWithOwner(owner, 'MPU003');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'mystery item',
      quantity: 1,
      unit: 'piece',
      category: null,
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    await handler(buildEvent(itemId, 'sub-mp-newrow-noexpiry'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.expiryDate).toBeNull();
  });

  it('increments an existing matching pantry row and does NOT overwrite its existing expiry (increment path untouched)', async () => {
    const owner = await createUser('sub-mp-increment');
    const householdId = await createHouseholdWithOwner(owner, 'MPU004');
    await seedPantryItem(owner, householdId, {
      name: 'onion',
      quantity: 2,
      unit: 'piece',
      category: 'produce',
      expiryDate: '2099-01-01',
    });
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'onion',
      quantity: 3,
      unit: 'piece',
      category: 'produce',
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    await handler(buildEvent(itemId, 'sub-mp-increment'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(5);
    // Untouched — NOT recomputed to produce's own 7-day default.
    expect(pantryItems[0]?.expiryDate).toBe('2099-01-01');
  });

  it('rejects a second markPurchased call on the same item with ConflictError (explicit, not idempotent)', async () => {
    const owner = await createUser('sub-mp-twice');
    const householdId = await createHouseholdWithOwner(owner, 'MPU005');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'potato',
      quantity: 4,
      unit: 'piece',
      category: null,
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    await handler(buildEvent(itemId, 'sub-mp-twice'));

    await expect(handler(buildEvent(itemId, 'sub-mp-twice'))).rejects.toThrow(ConflictError);

    // Never double-incremented the pantry from the rejected second call.
    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(4);
  });

  it('marks the shopping-list item purchased/movedToPantry together with the pantry write in one call', async () => {
    const owner = await createUser('sub-mp-atomic-ok');
    const householdId = await createHouseholdWithOwner(owner, 'MPU006');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'ginger',
      quantity: 1,
      unit: 'piece',
      category: null,
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    const result = await handler(buildEvent(itemId, 'sub-mp-atomic-ok'));

    const markedItem = result.items.find((entry) => entry.id === itemId);
    expect(markedItem?.purchased).toBe(true);
    expect(markedItem?.movedToPantry).toBe(true);

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.name).toBe('ginger');
  });

  it('a forced failure on the shopping-list write rolls back the pantry write too (atomicity)', async () => {
    const owner = await createUser('sub-mp-atomic-fail');
    const householdId = await createHouseholdWithOwner(owner, 'MPU007');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'coriander',
      quantity: 1,
      unit: 'bunch',
      category: null,
    });

    const failingMarkItemPurchased: MarkPurchasedResolverDeps['markItemPurchased'] = async () => {
      throw new Error('simulated failure marking the item purchased');
    };
    const handler = createMarkPurchasedHandler({ ...baseDeps, markItemPurchased: failingMarkItemPurchased });

    await expect(handler(buildEvent(itemId, 'sub-mp-atomic-fail'))).rejects.toThrow(
      'simulated failure marking the item purchased',
    );

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(0);
  });

  it('a forced failure on the pantry write leaves the shopping-list item unmarked (atomicity)', async () => {
    const owner = await createUser('sub-mp-atomic-fail2');
    const householdId = await createHouseholdWithOwner(owner, 'MPU008');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'turmeric',
      quantity: 1,
      unit: 'packet',
      category: null,
    });

    const failingUpsert: MarkPurchasedResolverDeps['upsertOrIncrementPantryItemForHaveIt'] = async () => {
      throw new Error('simulated failure upserting the pantry row');
    };
    const handler = createMarkPurchasedHandler({
      ...baseDeps,
      upsertOrIncrementPantryItemForHaveIt: failingUpsert,
    });

    await expect(handler(buildEvent(itemId, 'sub-mp-atomic-fail2'))).rejects.toThrow(
      'simulated failure upserting the pantry row',
    );

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(0);

    const handler2 = createMarkPurchasedHandler(baseDeps);
    const result = await handler2(buildEvent(itemId, 'sub-mp-atomic-fail2'));
    const markedItem = result.items.find((entry) => entry.id === itemId);
    expect(markedItem?.purchased).toBe(true);
  });

  it('D5 regression: takes no quantity argument — always uses the item\'s own listed quantity, even if a stray one is sent', async () => {
    const owner = await createUser('sub-mp-d5');
    const householdId = await createHouseholdWithOwner(owner, 'MPU009');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'basmati rice',
      quantity: 2,
      unit: 'kg',
      category: 'grain',
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    // A stray `quantity` field (simulating a stale client) must be
    // silently ignored — the pantry write uses the item's own `2`, not
    // this `999`.
    await handler(buildEvent(itemId, 'sub-mp-d5', { quantity: 999 }));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(2);
  });

  it("the mutation's return value satisfies ShoppingList! shape end-to-end", async () => {
    const owner = await createUser('sub-mp-shape');
    const householdId = await createHouseholdWithOwner(owner, 'MPU010');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'lemon',
      quantity: 2,
      unit: 'piece',
      category: null,
    });

    const handler = createMarkPurchasedHandler(baseDeps);
    const result = await handler(buildEvent(itemId, 'sub-mp-shape'));

    expect(result.id).toBeTruthy();
    expect(result.householdId).toBe(householdId);
    expect(Array.isArray(result.items)).toBe(true);
    const item = result.items.find((entry) => entry.id === itemId);
    expect(item).toMatchObject({
      id: itemId,
      name: 'lemon',
      purchased: true,
      movedToPantry: true,
    });
  });
});
