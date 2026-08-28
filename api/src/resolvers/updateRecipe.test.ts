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
  findRecipes,
  insertRecipe,
  insertRecipeIngredient,
} from '../repositories/recipeRepository.js';
import type { RecipeRow } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createUpdateRecipeHandler } from './updateRecipe.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';

const buildEvent = (
  id: unknown,
  input: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ id: unknown; input: unknown }> => ({
  arguments: { id, input },
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
        } as unknown as AppSyncResolverEvent<{ id: unknown; input: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'updateRecipe',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('updateRecipe resolver', () => {
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

  const createRecipeFixture = async (
    householdId: string,
    ownerId: string,
    overrides: { title?: string } = {},
  ): Promise<RecipeRow> =>
    asUser(ownerId, (client) =>
      insertRecipe(client, {
        householdId,
        sourceType: 'user',
        sourceUrl: null,
        title: overrides.title ?? 'Rajma Chawal',
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
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), { title: 'X' }, null))).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('rejects a non-UUID id with ValidationError before touching the database', async () => {
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent('not-a-uuid', { title: 'X' }, 'sub-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an empty patch with ValidationError', async () => {
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), {}, 'sub-empty'))).rejects.toThrow(ValidationError);
  });

  it('denies updating a nonexistent recipe with NotFoundError', async () => {
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), { title: 'X' }, 'sub-nonexistent')),
    ).rejects.toThrow(NotFoundError);
  });

  it("denies updating another household's recipe identically to a nonexistent id", async () => {
    const ownerA = await createUser('sub-owner-a');
    const ownerB = await createUser('sub-owner-b');
    const householdA = await createHouseholdWithMember(ownerA, 'AAA234');
    await createHouseholdWithMember(ownerB, 'BBB234');
    const recipe = await createRecipeFixture(householdA, ownerA.id);
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });

    let realError: Error | undefined;
    try {
      await handler(buildEvent(recipe.id, { title: 'Hijacked' }, 'sub-owner-b'));
    } catch (error) {
      realError = error as Error;
    }
    let fakeError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), { title: 'Hijacked' }, 'sub-owner-b'));
    } catch (error) {
      fakeError = error as Error;
    }

    expect(realError).toBeInstanceOf(NotFoundError);
    expect(fakeError).toBeInstanceOf(NotFoundError);
    expect(realError?.message).toBe(fakeError?.message);
  });

  it('leaves absent scalar fields unchanged and bumps updated_at', async () => {
    const owner = await createUser('sub-owner-partial');
    const householdId = await createHouseholdWithMember(owner, 'PAR234');
    const recipe = await createRecipeFixture(householdId, owner.id, { title: 'Original Title' });
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(recipe.id, { servings: 6 }, 'sub-owner-partial'));

    expect(result.title).toBe('Original Title');
    expect(result.servings).toBe(6);
    expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(recipe.updatedAt.getTime());
  });

  it('rejects an explicit null for a scalar field with ValidationError', async () => {
    const owner = await createUser('sub-owner-null');
    const householdId = await createHouseholdWithMember(owner, 'NUL234');
    const recipe = await createRecipeFixture(householdId, owner.id);
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });

    await expect(
      handler(buildEvent(recipe.id, { title: null }, 'sub-owner-null')),
    ).rejects.toThrow(ValidationError);
  });

  it('an absent ingredients key leaves the existing ingredient list untouched', async () => {
    const owner = await createUser('sub-owner-absent-ing');
    const householdId = await createHouseholdWithMember(owner, 'ABS234');
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
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, { title: 'Renamed' }, 'sub-owner-absent-ing'));

    const ingredients = await asUser(owner.id, (client) =>
      findRecipeIngredientsByRecipeId(client, recipe.id),
    );
    expect(ingredients.map((i) => i.name)).toEqual(['Onion']);
  });

  it('an explicit empty ingredients array clears every existing ingredient', async () => {
    const owner = await createUser('sub-owner-clear-ing');
    const householdId = await createHouseholdWithMember(owner, 'CLR234');
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
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });

    await handler(buildEvent(recipe.id, { ingredients: [] }, 'sub-owner-clear-ing'));

    const ingredients = await asUser(owner.id, (client) =>
      findRecipeIngredientsByRecipeId(client, recipe.id),
    );
    expect(ingredients).toEqual([]);
  });

  it('a present ingredients array replaces the whole list, not merges', async () => {
    const owner = await createUser('sub-owner-replace-ing');
    const householdId = await createHouseholdWithMember(owner, 'REP234');
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
    const handler = createUpdateRecipeHandler({ getPool: async () => pool });

    await handler(
      buildEvent(
        recipe.id,
        { ingredients: [{ name: 'Rajma beans' }, { name: 'Ginger' }] },
        'sub-owner-replace-ing',
      ),
    );

    const ingredients = await asUser(owner.id, (client) =>
      findRecipeIngredientsByRecipeId(client, recipe.id),
    );
    expect(ingredients.map((i) => i.name)).toEqual(['Rajma beans', 'Ginger']);
  });

  it('rolls back the whole update (including the scalar patch) when the ingredient re-insert fails', async () => {
    const owner = await createUser('sub-owner-rollback');
    const householdId = await createHouseholdWithMember(owner, 'ROL234');
    const recipe = await createRecipeFixture(householdId, owner.id, { title: 'Original' });
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

    let callCount = 0;
    const failingInsert: typeof insertRecipeIngredient = async (client, insertInput) => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('simulated failure on the second ingredient');
      }
      return insertRecipeIngredient(client, insertInput);
    };

    const handler = createUpdateRecipeHandler({
      getPool: async () => pool,
      insertRecipeIngredient: failingInsert,
    });

    await expect(
      handler(
        buildEvent(
          recipe.id,
          { title: 'Changed', ingredients: [{ name: 'A' }, { name: 'B' }] },
          'sub-owner-rollback',
        ),
      ),
    ).rejects.toThrow('simulated failure on the second ingredient');

    const ingredients = await asUser(owner.id, (client) =>
      findRecipeIngredientsByRecipeId(client, recipe.id),
    );
    // Neither the delete-and-replace nor the title change persisted.
    expect(ingredients.map((i) => i.name)).toEqual(['Onion']);

    const recipes = await asUser(owner.id, (client) => findRecipes(client, householdId));
    expect(recipes.map((r) => r.title)).toEqual(['Original']);
  });
});
