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
import { insertRecipe } from '../repositories/recipeRepository.js';
import type { RecipeRow } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createFavoriteRecipeHandler } from './favoriteRecipe.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';

const buildEvent = (
  id: unknown,
  favorite: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ id: unknown; favorite: unknown }> => ({
  arguments: { id, favorite },
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
        } as unknown as AppSyncResolverEvent<{ id: unknown; favorite: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'favoriteRecipe',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('favoriteRecipe resolver', () => {
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

  const createHouseholdWithMember = async (
    owner: UserRow,
    inviteCode: string,
    role: 'primary' | 'member' = 'primary',
  ): Promise<string> =>
    asUser(owner.id, async (client) => {
      const household = await insertHousehold(client, {
        name: `House ${inviteCode}`,
        inviteCode,
        primaryUserId: owner.id,
      });
      await insertMembership(client, { householdId: household.id, userId: owner.id, role });
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
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), true, null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-UUID id with ValidationError before touching the database', async () => {
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('not-a-uuid', true, 'sub-validation'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('denies favoriting a nonexistent recipe with NotFoundError', async () => {
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), true, 'sub-nonexistent'))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("denies favoriting another household's recipe identically to a nonexistent id", async () => {
    const ownerA = await createUser('sub-owner-a');
    const ownerB = await createUser('sub-owner-b');
    const householdA = await createHouseholdWithMember(ownerA, 'AAA234');
    await createHouseholdWithMember(ownerB, 'BBB234');
    const recipe = await createRecipeFixture(householdA, ownerA.id);
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });

    let realError: Error | undefined;
    try {
      await handler(buildEvent(recipe.id, true, 'sub-owner-b'));
    } catch (error) {
      realError = error as Error;
    }
    let fakeError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), true, 'sub-owner-b'));
    } catch (error) {
      fakeError = error as Error;
    }

    expect(realError).toBeInstanceOf(NotFoundError);
    expect(fakeError).toBeInstanceOf(NotFoundError);
    expect(realError?.message).toBe(fakeError?.message);
  });

  it('happy path: favorites a recipe and bumps updated_at', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(recipe.id, true, 'sub-owner-happy'));

    expect(result.isFavorite).toBe(true);
    expect(new Date(result.updatedAt).getTime()).toBeGreaterThanOrEqual(recipe.updatedAt.getTime());
  });

  it('favorite: false un-favorites', async () => {
    const owner = await createUser('sub-owner-unfav');
    const householdId = await createHouseholdWithMember(owner, 'UNF234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, true, 'sub-owner-unfav'));
    const result = await handler(buildEvent(recipe.id, false, 'sub-owner-unfav'));

    expect(result.isFavorite).toBe(false);
  });

  it('is idempotent — favoriting an already-favorite recipe succeeds and stays favorite', async () => {
    const owner = await createUser('sub-owner-idempotent');
    const householdId = await createHouseholdWithMember(owner, 'IDP234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, true, 'sub-owner-idempotent'));
    const result = await handler(buildEvent(recipe.id, true, 'sub-owner-idempotent'));

    expect(result.isFavorite).toBe(true);
  });

  it('is household-level, not per-user — a second member sees the flag another member set', async () => {
    const owner = await createUser('sub-owner-shared');
    const member = await createUser('sub-member-shared');
    const householdId = await createHouseholdWithMember(owner, 'SHR234');
    await asUser(owner.id, (client) =>
      insertMembership(client, { householdId, userId: member.id, role: 'member' }),
    );
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createFavoriteRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, true, 'sub-owner-shared'));
    const result = await handler(buildEvent(recipe.id, true, 'sub-member-shared'));

    expect(result.isFavorite).toBe(true);
  });
});
