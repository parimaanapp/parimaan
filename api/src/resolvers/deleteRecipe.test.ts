import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import {
  findRecipeIngredientsByRecipeId,
  insertRecipe,
  insertRecipeIngredient,
} from '../repositories/recipeRepository.js';
import type { RecipeRow } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createDeleteRecipeHandler } from './deleteRecipe.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';

const buildEvent = (
  id: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ id: unknown }> => ({
  arguments: { id },
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
        } as unknown as AppSyncResolverEvent<{ id: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'deleteRecipe',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('deleteRecipe resolver', () => {
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

  const asUser = <T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> =>
    withUserTransaction(userId, fn, pool);

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

  const createHouseholdWithMember = async (owner: UserRow, inviteCode: string): Promise<string> =>
    asUser(owner.id, async (client) => {
      const household = await insertHousehold(client, {
        name: `House ${inviteCode}`,
        inviteCode,
        primaryUserId: owner.id,
      });
      await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
      return household.id;
    });

  const createRecipeFixture = async (householdId: string, ownerId: string): Promise<RecipeRow> =>
    asUser(ownerId, (client) =>
      insertRecipe(client, {
        householdId,
        sourceType: 'user',
        sourceUrl: null,
        title: 'Rajma Chawal',
        description: null,
        servings: 4,
        prepMin: null,
        cookMin: null,
        cuisineTier1: null,
        cuisineTier2: null,
        dietaryTags: [],
        role: 'sabzi_dal',
        inRotation: true,
        steps: [],
        createdBy: ownerId,
      }),
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-UUID id with ValidationError before touching the database', async () => {
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('not-a-uuid', 'sub-validation'))).rejects.toThrow(ValidationError);
  });

  it('denies deleting a nonexistent recipe with NotFoundError', async () => {
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), 'sub-nonexistent'))).rejects.toThrow(NotFoundError);
  });

  it("denies deleting another household's recipe identically to a nonexistent id", async () => {
    const ownerA = await createUser('sub-owner-a');
    const ownerB = await createUser('sub-owner-b');
    const householdA = await createHouseholdWithMember(ownerA, 'AAA234');
    await createHouseholdWithMember(ownerB, 'BBB234');
    const recipe = await createRecipeFixture(householdA, ownerA.id);
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });

    let realError: Error | undefined;
    try {
      await handler(buildEvent(recipe.id, 'sub-owner-b'));
    } catch (error) {
      realError = error as Error;
    }
    let fakeError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), 'sub-owner-b'));
    } catch (error) {
      fakeError = error as Error;
    }

    expect(realError).toBeInstanceOf(NotFoundError);
    expect(fakeError).toBeInstanceOf(NotFoundError);
    expect(realError?.message).toBe(fakeError?.message);
  });

  it('happy path: deletes the recipe and returns the deleted row', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(recipe.id, 'sub-owner-happy'));

    expect(result.id).toBe(recipe.id);
    expect(result.title).toBe('Rajma Chawal');
  });

  it('a second call for the same id denies identically to the first call ever having been for a nonexistent recipe', async () => {
    const owner = await createUser('sub-owner-twice');
    const householdId = await createHouseholdWithMember(owner, 'TWC234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, 'sub-owner-twice'));

    await expect(handler(buildEvent(recipe.id, 'sub-owner-twice'))).rejects.toThrow(NotFoundError);
  });

  it('cascades to recipe_ingredients', async () => {
    const owner = await createUser('sub-owner-cascade');
    const householdId = await createHouseholdWithMember(owner, 'CAS234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    await asUser(owner.id, (client) =>
      insertRecipeIngredient(client, {
        recipeId: recipe.id,
        name: 'Onion',
        quantity: null,
        unit: null,
        category: null,
        notes: null,
        isStaple: false,
        sortOrder: 0,
      }),
    );
    const handler = createDeleteRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, 'sub-owner-cascade'));

    const ingredients = await asUser(owner.id, (client) =>
      findRecipeIngredientsByRecipeId(client, recipe.id),
    );
    expect(ingredients).toEqual([]);
  });
});
