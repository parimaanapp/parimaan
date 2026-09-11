import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createMenu as createMenuRepo } from '../repositories/menuRepository.js';
import { insertRecipe, insertRecipeIngredient } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { findShoppingListById } from '../repositories/shoppingListRepository.js';
import { findMenuById, findMenuItems } from '../repositories/menuRepository.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import { createGenerateShoppingListHandler } from './generateShoppingList.js';
import { createStaplesNoteFnHandler, MAX_STAPLES_NOTES_PER_DAY } from './staplesNoteFn.js';
import type { StaplesNoteFnDeps, StaplesNoteFnEvent } from './staplesNoteFn.js';
import type { StaplesNoteOutput } from '../ai/schemas/staplesNote.js';
import { getCachedStaplesNote, putCachedStaplesNote } from '../aiCache/staplesNoteCache.js';
import { computeRecipeSetHash } from '../domain/recipeSetHash.js';
import { AiUnavailableError } from '../errors.js';

const identityFor = (cognitoSub: string): AppSyncResolverEvent<unknown>['identity'] =>
  ({
    sub: cognitoSub,
    issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
    username: cognitoSub,
    claims: { email: `${cognitoSub}@example.test` },
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
  }) as unknown as AppSyncResolverEvent<unknown>['identity'];

const generateEvent = (menuId: unknown, cognitoSub: string): AppSyncResolverEvent<{ menuId: unknown }> => ({
  arguments: { menuId },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
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

describe('staplesNoteFn (W17 S3, E2E_MVP_PLAN.md §23.2.2/§23.2.6/§23.2.7)', () => {
  let db: TestDatabase;
  let ddb: TestDynamoDb;
  let pool: Pool;

  beforeAll(async () => {
    [db, ddb] = await Promise.all([startTestDatabase(), startTestDynamoDb()]);
    pool = new Pool({ connectionString: db.appUri });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
    await ddb.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const baseDeps = (callModel: (prompt: string) => Promise<StaplesNoteOutput>): StaplesNoteFnDeps => ({
    getPool: async () => pool,
    getDdbClient: () => ddb.client,
    getCacheTableName: () => ddb.tableName,
    callModel,
  });

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
    owner: UserRow,
    householdId: string,
    title: string,
    ingredients: readonly { name: string; quantity: number | null; unit: string | null }[],
  ): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
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
          createdBy: owner.id,
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
      },
      pool,
    );

  const placeItem = async (menuId: string, recipeId: string, dayOfWeek: number, ownerSub: string): Promise<void> => {
    const handler = createAddMenuItemHandler({ getPool: async () => pool });
    await handler(addMenuItemBuildEvent(menuId, { recipeId, dayOfWeek, mealSlot: 'lunch', slotRole: 'carb' }, ownerSub));
  };

  /** Builds a household + menu + one recipe + a generated shopping list, returning everything a test needs. */
  const setUpPlannedWeek = async (
    seed: string,
  ): Promise<{ owner: UserRow; householdId: string; menuId: string; listId: string; recipeId: string }> => {
    const owner = await createUser(`sub-snf-${seed}`);
    const householdId = await createHouseholdWithOwner(owner, seed.toUpperCase().slice(0, 8));
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await addRecipeWithIngredients(owner, householdId, 'Rajma', [
      { name: 'onion', quantity: 2, unit: 'piece' },
      { name: 'jeera', quantity: 1, unit: 'tsp' },
    ]);
    await placeItem(menuId, recipeId, 0, `sub-snf-${seed}`);
    const generateHandler = createGenerateShoppingListHandler({ getPool: async () => pool });
    const generated = await generateHandler(generateEvent(menuId, `sub-snf-${seed}`));
    return { owner, householdId, menuId, listId: generated.id, recipeId };
  };

  const runHandler = async (
    event: StaplesNoteFnEvent,
    callModel: (prompt: string) => Promise<StaplesNoteOutput>,
  ): Promise<void> => {
    const handler = createStaplesNoteFnHandler(baseDeps(callModel));
    await handler(event);
  };

  /**
   * `shopping_lists` is RLS-protected — reading it (like every other
   * RLS-protected read in this file) MUST go through `withUserTransaction`
   * so `parimaan.user_id` is actually set for the query. A bare
   * `pool.connect()` read (no `SET LOCAL`) is not just unauthorized, it's
   * unsafe on a POOLED connection: once any transaction on that same
   * pooled connection has set the custom `parimaan.user_id` GUC, Postgres
   * remembers the placeholder for the rest of the connection's session,
   * so a later un-scoped read on the same connection sees it as an empty
   * string rather than erroring outright — `''::UUID` then fails loudly
   * inside the RLS policy check itself.
   */
  const readAiStaplesNote = async (owner: UserRow, listId: string): Promise<string | null> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const list = await findShoppingListById(client, listId);
        return list?.aiStaplesNote ?? null;
      },
      pool,
    );

  /** Computes the SAME `recipeSetHash` `staplesNoteFn` itself computes for `listId`'s current plan — via `withUserTransaction`, so a failure never leaves a poisoned connection behind for a later test. */
  const hashForList = async (owner: UserRow, listId: string): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const list = await findShoppingListById(client, listId);
        if (list === null || list.generatedFromMenuId === null) {
          throw new Error(`hashForList: no menu for listId=${listId}`);
        }
        const menu = await findMenuById(client, list.generatedFromMenuId);
        if (menu === null) {
          throw new Error(`hashForList: menu not found for listId=${listId}`);
        }
        const items = await findMenuItems(client, menu.id);
        return computeRecipeSetHash(items.map((item) => ({ recipeId: item.recipe.id, servingsOverride: item.servingsOverride })));
      },
      pool,
    );

  it('a cache HIT skips the model call entirely and writes the cached note', async () => {
    const { owner, householdId, listId } = await setUpPlannedWeek('cachehit');

    // Seed the cache directly under the exact hash this list's planned
    // recipe set will produce — same shape `putCachedStaplesNote` writes.
    const hash = await hashForList(owner, listId);
    await putCachedStaplesNote(ddb.client, ddb.tableName, hash, 'Cached: check your jeera.');

    const callModel = vi.fn();
    await runHandler({ listId, householdId }, callModel);

    expect(callModel).not.toHaveBeenCalled();
    expect(await readAiStaplesNote(owner, listId)).toBe('Cached: check your jeera.');
  });

  it('a cache MISS calls the model, writes the result, and writes a cache entry with a 24-hr TTL', async () => {
    const { owner, householdId, listId } = await setUpPlannedWeek('cachemiss');

    const callModel = vi.fn().mockResolvedValue({ note: 'You might need jeera this week.' });
    await runHandler({ listId, householdId }, callModel);

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(await readAiStaplesNote(owner, listId)).toBe('You might need jeera this week.');

    const hash = await hashForList(owner, listId);
    const cached = await getCachedStaplesNote(ddb.client, ddb.tableName, hash);
    expect(cached).toBe('You might need jeera this week.');

    const raw = await ddb.client.send(
      new (await import('@aws-sdk/lib-dynamodb')).GetCommand({
        TableName: ddb.tableName,
        Key: { PK: `aiCache#staplesNote#${hash}`, SK: 'NOTE' },
      }),
    );
    expect(typeof raw.Item?.ttl).toBe('number');
    expect(raw.Item?.ttl).toBeGreaterThan(Date.now() / 1000);
  });

  it('a rate-limit exhaustion produces no write to ai_staples_note and no thrown error', async () => {
    const { owner, householdId, listId } = await setUpPlannedWeek('ratelimit');

    // Pre-seed the DynamoDB rate-limit counter to the cap — same
    // single-table shape `dailyActionLimiter.ts` itself writes.
    const today = new Date().toISOString().slice(0, 10);
    await ddb.client.send(
      new UpdateCommand({
        TableName: ddb.tableName,
        Key: { PK: `RATELIMIT#staplesNote#${owner.id}`, SK: today },
        UpdateExpression: 'ADD attempts :max SET #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':max': MAX_STAPLES_NOTES_PER_DAY, ':ttl': Math.floor(Date.now() / 1000) + 3600 },
      }),
    );

    const callModel = vi.fn();
    await expect(runHandler({ listId, householdId }, callModel)).resolves.toBeUndefined();

    expect(callModel).not.toHaveBeenCalled();
    expect(await readAiStaplesNote(owner, listId)).toBeNull();
  });

  it('a model failure produces no write and no thrown error, no retry beyond invokeModel itself', async () => {
    const { owner, householdId, listId } = await setUpPlannedWeek('modelfail');

    const callModel = vi.fn().mockRejectedValue(new AiUnavailableError());
    await expect(runHandler({ listId, householdId }, callModel)).resolves.toBeUndefined();

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(await readAiStaplesNote(owner, listId)).toBeNull();
  });

  it('two different recipe sets never collide in the cache', async () => {
    const a = await setUpPlannedWeek('setacollide');
    const b = await setUpPlannedWeek('setbcollide');

    const callModelA = vi.fn().mockResolvedValue({ note: 'Note for set A.' });
    const callModelB = vi.fn().mockResolvedValue({ note: 'Note for set B.' });

    await runHandler({ listId: a.listId, householdId: a.householdId }, callModelA);
    await runHandler({ listId: b.listId, householdId: b.householdId }, callModelB);

    expect(callModelA).toHaveBeenCalledTimes(1);
    expect(callModelB).toHaveBeenCalledTimes(1);
    expect(await readAiStaplesNote(a.owner, a.listId)).toBe('Note for set A.');
    expect(await readAiStaplesNote(b.owner, b.listId)).toBe('Note for set B.');
  });

  it('the SAME recipe set queried twice produces exactly one real model call (the second is a cache hit)', async () => {
    const first = await setUpPlannedWeek('sametwice');

    const callModel = vi.fn().mockResolvedValue({ note: 'Only called once.' });
    await runHandler({ listId: first.listId, householdId: first.householdId }, callModel);
    // Re-invoke for the SAME list a second time — same recipeSetHash, so
    // this must be served from the cache.
    await runHandler({ listId: first.listId, householdId: first.householdId }, callModel);

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(await readAiStaplesNote(first.owner, first.listId)).toBe('Only called once.');
  });

  // D6's own bug fix — the single most important test in this slice.
  // SD §7.3's original sketch keyed the cache on the raw `listId`, which
  // `regenerateShoppingList` reuses for the SAME row after the underlying
  // plan changes — a raw-`listId` cache would incorrectly serve the STALE,
  // pre-regenerate note for a full 24 hours. Keying on `recipeSetHash`
  // instead means a regenerate that changes the planned recipes produces a
  // DIFFERENT hash and therefore a fresh (correct), non-cached model call.
  it('a regenerate that changes the planned recipes produces a DIFFERENT recipeSetHash and a fresh (non-cached) model call', async () => {
    const week = await setUpPlannedWeek('regenhash');

    const firstCallModel = vi.fn().mockResolvedValue({ note: 'Original plan note.' });
    await runHandler({ listId: week.listId, householdId: week.householdId }, firstCallModel);
    expect(firstCallModel).toHaveBeenCalledTimes(1);
    expect(await readAiStaplesNote(week.owner, week.listId)).toBe('Original plan note.');

    // Change the plan: add a second, different recipe to the same menu —
    // the same `regenerateShoppingList` would trigger on a real change,
    // reused directly on the SAME shopping list row (D8's own merge, same
    // `listId`).
    const secondRecipeId = await addRecipeWithIngredients(week.owner, week.householdId, 'Chole', [
      { name: 'chickpeas', quantity: 400, unit: 'g' },
    ]);
    await placeItem(week.menuId, secondRecipeId, 1, `sub-snf-regenhash`);

    const secondCallModel = vi.fn().mockResolvedValue({ note: 'Updated plan note.' });
    await runHandler({ listId: week.listId, householdId: week.householdId }, secondCallModel);

    // A DIFFERENT hash means this was NOT served from the first call's
    // cache entry — the model was called again, and the note actually
    // changed to reflect the new plan.
    expect(secondCallModel).toHaveBeenCalledTimes(1);
    expect(await readAiStaplesNote(week.owner, week.listId)).toBe('Updated plan note.');
  });

  it('an invalid payload (missing/malformed fields) is logged and swallowed, never thrown', async () => {
    const callModel = vi.fn();
    const handler = createStaplesNoteFnHandler(baseDeps(callModel));
    await expect(handler({ listId: 'not-a-uuid', householdId: 'also-not-a-uuid' } as StaplesNoteFnEvent)).resolves.toBeUndefined();
    expect(callModel).not.toHaveBeenCalled();
  });

  it('a nonexistent householdId is logged and swallowed, never thrown', async () => {
    const callModel = vi.fn();
    const handler = createStaplesNoteFnHandler(baseDeps(callModel));
    await expect(
      handler({ listId: '00000000-0000-0000-0000-000000000000', householdId: '00000000-0000-0000-0000-000000000001' }),
    ).resolves.toBeUndefined();
    expect(callModel).not.toHaveBeenCalled();
  });
});
