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
import { createHaveItHandler } from './haveIt.js';
import type { HaveItResolverDeps } from './haveIt.js';
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
  quantity: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ itemId: unknown; quantity: unknown }> => ({
  arguments: { itemId, quantity },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'items'],
    selectionSetGraphQL: '{ id items { id purchased movedToPantry } }',
    parentTypeName: 'Mutation',
    fieldName: 'haveIt',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('haveIt resolver (Mutation.haveIt)', () => {
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

  const baseDeps: HaveItResolverDeps = { getPool: async () => pool };

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
          title: 'haveIt test recipe',
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

  /** Seeds a fresh shopping list (no menu) with exactly `items`, directly via the repository — bypassing `generateShoppingList` so each test controls names/units/quantities precisely. Returns the inserted rows' ids. */
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
    input: { name: string; quantity: number; unit: string },
  ): Promise<PantryItemRow> =>
    withUserTransaction(
      owner.id,
      (client) =>
        insertPantryItem(client, {
          householdId,
          name: input.name,
          quantity: input.quantity,
          unit: input.unit,
          category: null,
          isStaple: false,
          expiryDate: null,
          lowThreshold: null,
          addedBy: owner.id,
        }),
      pool,
    );

  const getPantryItems = async (owner: UserRow, householdId: string): Promise<PantryItemRow[]> =>
    withUserTransaction(owner.id, (client) => findPantryItems(client, householdId), pool);

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 1, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid itemId', 'not-a-uuid', 5],
    ['absent itemId', undefined, 5],
    ['explicit null itemId', null, 5],
  ])('rejects a %s with ValidationError', async (_label, itemId, quantity) => {
    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(itemId, quantity, 'sub-hi-validation'))).rejects.toThrow(ValidationError);
  });

  it('rejects a zero quantity with ValidationError, never reaching the transaction', async () => {
    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 0, 'sub-hi-zero'))).rejects.toThrow(ValidationError);
  });

  it('rejects a negative quantity with ValidationError, never reaching the transaction', async () => {
    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), -2, 'sub-hi-negative'))).rejects.toThrow(ValidationError);
  });

  it('rejects an explicit null quantity with ValidationError', async () => {
    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), null, 'sub-hi-null-qty'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-hi-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'HVI001');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'toor dal',
      quantity: 500,
      unit: 'g',
      category: null,
    });
    await createUser('sub-hi-stranger-denial');

    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(itemId, 500, 'sub-hi-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(itemId, 500, 'sub-hi-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent itemId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-hi-oracle');
    const handler = createHaveItHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 1, 'sub-hi-oracle'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 1, 'sub-hi-oracle'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('creates a new pantry row at the confirmed quantity when no matching row exists', async () => {
    const owner = await createUser('sub-hi-newrow');
    const householdId = await createHouseholdWithOwner(owner, 'HVI002');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'toor dal',
      quantity: 500,
      unit: 'g',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    const result = await handler(buildEvent(itemId, 500, 'sub-hi-newrow'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.name).toBe('toor dal');
    expect(pantryItems[0]?.quantity).toBe(500);
    expect(pantryItems[0]?.unit).toBe('g');

    const markedItem = result.items.find((entry) => entry.id === itemId);
    expect(markedItem?.purchased).toBe(true);
    expect(markedItem?.movedToPantry).toBe(true);
    expect(markedItem?.purchasedBy).toBe(owner.id);
    expect(markedItem?.purchasedAt).toBeTruthy();
    expect(result.householdId).toBe(householdId);
  });

  it('increments an existing pantry row matched by exact name + unit', async () => {
    const owner = await createUser('sub-hi-increxact');
    const householdId = await createHouseholdWithOwner(owner, 'HVI003');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 2, unit: 'piece' });
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'onion',
      quantity: 3,
      unit: 'piece',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    await handler(buildEvent(itemId, 3, 'sub-hi-increxact'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(5);
  });

  it('increments an existing pantry row matched by fuzzy name + same unit (D2)', async () => {
    const owner = await createUser('sub-hi-increfuzzy');
    const householdId = await createHouseholdWithOwner(owner, 'HVI004');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 2, unit: 'piece' });
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'onions',
      quantity: 3,
      unit: 'piece',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    await handler(buildEvent(itemId, 3, 'sub-hi-increfuzzy'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(5);
  });

  it('converts and increments across a same-family, different unit (D3: shopping-list g against a pantry kg row)', async () => {
    const owner = await createUser('sub-hi-convert');
    const householdId = await createHouseholdWithOwner(owner, 'HVI005');
    await seedPantryItem(owner, householdId, { name: 'sugar', quantity: 1, unit: 'kg' });
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'sugar',
      quantity: 500,
      unit: 'g',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    await handler(buildEvent(itemId, 500, 'sub-hi-convert'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    // 1 kg existing + 500 g (converted to 0.5 kg) = 1.5 kg — the EXISTING
    // row's own unit (`kg`) is preserved, never silently rewritten.
    expect(pantryItems[0]?.unit).toBe('kg');
    expect(pantryItems[0]?.quantity).toBeCloseTo(1.5, 6);
  });

  it('creates a SECOND row for a genuinely different ingredient rather than merging', async () => {
    const owner = await createUser('sub-hi-different');
    const householdId = await createHouseholdWithOwner(owner, 'HVI006');
    await seedPantryItem(owner, householdId, { name: 'onion', quantity: 2, unit: 'piece' });
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'onion powder',
      quantity: 1,
      unit: 'piece',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    await handler(buildEvent(itemId, 1, 'sub-hi-different'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(2);
    expect(pantryItems.some((row) => row.name === 'onion' && row.quantity === 2)).toBe(true);
    expect(pantryItems.some((row) => row.name === 'onion powder' && row.quantity === 1)).toBe(true);
  });

  it('creates a SECOND row for a matching name in a cross-family/unconvertible unit rather than incorrectly summing', async () => {
    const owner = await createUser('sub-hi-crossfamily');
    const householdId = await createHouseholdWithOwner(owner, 'HVI007');
    await seedPantryItem(owner, householdId, { name: 'rice', quantity: 5, unit: 'piece' });
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'rice',
      quantity: 2,
      unit: 'kg',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    await handler(buildEvent(itemId, 2, 'sub-hi-crossfamily'));

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(2);
    expect(pantryItems.some((row) => row.unit === 'piece' && row.quantity === 5)).toBe(true);
    expect(pantryItems.some((row) => row.unit === 'kg' && row.quantity === 2)).toBe(true);
  });

  it('marks the shopping-list item purchased/movedToPantry together with the pantry write in one call', async () => {
    const owner = await createUser('sub-hi-atomic-ok');
    const householdId = await createHouseholdWithOwner(owner, 'HVI008');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'ginger',
      quantity: 1,
      unit: 'piece',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    const result = await handler(buildEvent(itemId, 1, 'sub-hi-atomic-ok'));

    const markedItem = result.items.find((entry) => entry.id === itemId);
    expect(markedItem?.purchased).toBe(true);
    expect(markedItem?.movedToPantry).toBe(true);

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.name).toBe('ginger');
  });

  it('a forced failure on the shopping-list write rolls back the pantry write too (atomicity)', async () => {
    const owner = await createUser('sub-hi-atomic-fail');
    const householdId = await createHouseholdWithOwner(owner, 'HVI009');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'coriander',
      quantity: 1,
      unit: 'bunch',
      category: null,
    });

    const failingMarkItemHaveIt: HaveItResolverDeps['markItemHaveIt'] = async () => {
      throw new Error('simulated failure marking the item purchased');
    };
    const handler = createHaveItHandler({ ...baseDeps, markItemHaveIt: failingMarkItemHaveIt });

    await expect(handler(buildEvent(itemId, 1, 'sub-hi-atomic-fail'))).rejects.toThrow(
      'simulated failure marking the item purchased',
    );

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(0);
  });

  it('a forced failure on the pantry write leaves the shopping-list item unmarked (atomicity)', async () => {
    const owner = await createUser('sub-hi-atomic-fail2');
    const householdId = await createHouseholdWithOwner(owner, 'HVI010');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'turmeric',
      quantity: 1,
      unit: 'packet',
      category: null,
    });

    const failingUpsert: HaveItResolverDeps['upsertOrIncrementPantryItemForHaveIt'] = async () => {
      throw new Error('simulated failure upserting the pantry row');
    };
    const handler = createHaveItHandler({ ...baseDeps, upsertOrIncrementPantryItemForHaveIt: failingUpsert });

    await expect(handler(buildEvent(itemId, 1, 'sub-hi-atomic-fail2'))).rejects.toThrow(
      'simulated failure upserting the pantry row',
    );

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(0);

    // The item must still read as un-purchased — re-run haveIt for real and
    // confirm it succeeds cleanly (would throw CONFLICT if the failed
    // attempt had somehow still marked it).
    const handler2 = createHaveItHandler(baseDeps);
    const result = await handler2(buildEvent(itemId, 1, 'sub-hi-atomic-fail2'));
    const markedItem = result.items.find((entry) => entry.id === itemId);
    expect(markedItem?.purchased).toBe(true);
  });

  it('rejects a second haveIt call on the same item with ConflictError (explicit, not idempotent)', async () => {
    const owner = await createUser('sub-hi-twice');
    const householdId = await createHouseholdWithOwner(owner, 'HVI011');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'potato',
      quantity: 4,
      unit: 'piece',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    await handler(buildEvent(itemId, 4, 'sub-hi-twice'));

    await expect(handler(buildEvent(itemId, 4, 'sub-hi-twice'))).rejects.toThrow(ConflictError);

    // Never double-incremented the pantry from the rejected second call.
    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(4);
  });

  it('serializes two concurrent haveIt calls for the same household so a shared new ingredient lands as ONE incremented row, never two duplicate ones (advisory lock)', async () => {
    const owner = await createUser('sub-hi-concurrent');
    const householdId = await createHouseholdWithOwner(owner, 'HVI013');
    // Two DISTINCT shopping-list lines that both fuzzy-name-match the same
    // ("onion"/"onions", D2's own documented pluralization case — Dice
    // ~0.89, above threshold) not-yet-in-pantry ingredient, in the same
    // unit — with no lock, both concurrent calls would read "no matching
    // pantry row" and both insert a separate row instead of one incremented
    // row (`lockPantryForHousehold`'s own doc).
    const itemIdA = await seedShoppingListItem(owner, householdId, {
      name: 'onion',
      quantity: 1,
      unit: 'piece',
      category: null,
    });
    const itemIdB = await seedShoppingListItem(owner, householdId, {
      name: 'onions',
      quantity: 2,
      unit: 'piece',
      category: null,
    });

    const handlerA = createHaveItHandler(baseDeps);
    const handlerB = createHaveItHandler(baseDeps);
    await Promise.all([
      handlerA(buildEvent(itemIdA, 1, 'sub-hi-concurrent')),
      handlerB(buildEvent(itemIdB, 2, 'sub-hi-concurrent')),
    ]);

    const pantryItems = await getPantryItems(owner, householdId);
    expect(pantryItems).toHaveLength(1);
    expect(pantryItems[0]?.quantity).toBe(3);
  });

  it("the mutation's return value satisfies ShoppingList! shape end-to-end", async () => {
    const owner = await createUser('sub-hi-shape');
    const householdId = await createHouseholdWithOwner(owner, 'HVI012');
    const itemId = await seedShoppingListItem(owner, householdId, {
      name: 'lemon',
      quantity: 2,
      unit: 'piece',
      category: null,
    });

    const handler = createHaveItHandler(baseDeps);
    const result = await handler(buildEvent(itemId, 2, 'sub-hi-shape'));

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
