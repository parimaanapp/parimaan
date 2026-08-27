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
import { createRecipeHandler } from './recipe.js';
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
    parentTypeName: 'Query',
    fieldName: 'recipe',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('recipe resolver (Query.recipe)', () => {
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
    const handler = createRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-UUID id with ValidationError before touching the database', async () => {
    const handler = createRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('not-a-uuid', 'sub-validation-rq'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('denies reading a nonexistent recipe with NotFoundError', async () => {
    const handler = createRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), 'sub-nonexistent-rq'))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("denies reading another household's recipe identically to a nonexistent id", async () => {
    const ownerA = await createUser('sub-owner-a-rq');
    const ownerB = await createUser('sub-owner-b-rq');
    const householdA = await createHouseholdWithMember(ownerA, 'AAA345');
    await createHouseholdWithMember(ownerB, 'BBB345');
    const recipe = await createRecipeFixture(householdA, ownerA.id);
    const handler = createRecipeHandler({ getPool: async () => pool });

    let realError: Error | undefined;
    try {
      await handler(buildEvent(recipe.id, 'sub-owner-b-rq'));
    } catch (error) {
      realError = error as Error;
    }
    let fakeError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), 'sub-owner-b-rq'));
    } catch (error) {
      fakeError = error as Error;
    }

    expect(realError).toBeInstanceOf(NotFoundError);
    expect(fakeError).toBeInstanceOf(NotFoundError);
    expect(realError?.message).toBe(fakeError?.message);
  });

  it('happy path: returns the recipe for a member of its household', async () => {
    const owner = await createUser('sub-owner-happy-rq');
    const householdId = await createHouseholdWithMember(owner, 'HAP345');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createRecipeHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(recipe.id, 'sub-owner-happy-rq'));

    expect(result.id).toBe(recipe.id);
    expect(result.title).toBe('Rajma Chawal');
  });

  it('a second member of the same household can also read the recipe', async () => {
    const owner = await createUser('sub-owner-second-rq');
    const secondMember = await createUser('sub-second-member-rq');
    const householdId = await createHouseholdWithMember(owner, 'SEC345');
    await asUser(owner.id, (client) =>
      insertMembership(client, { householdId, userId: secondMember.id, role: 'member' }),
    );
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createRecipeHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(recipe.id, 'sub-second-member-rq'));

    expect(result.id).toBe(recipe.id);
  });
});
