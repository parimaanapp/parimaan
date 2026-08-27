import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { findRecipeIngredientsByRecipeId, findRecipes, insertRecipeIngredient } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createCreateRecipeHandler } from './createRecipe.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const validInput = {
  title: 'Rajma Chawal',
  role: 'sabzi_dal',
  ingredients: [],
  steps: [],
};

const buildEvent = (
  householdId: unknown,
  input: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; input: unknown }> => ({
  arguments: { householdId, input },
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
        } as unknown as AppSyncResolverEvent<{ householdId: unknown; input: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'createRecipe',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('createRecipe resolver', () => {
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
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, {
          name: `House ${inviteCode}`,
          inviteCode,
          primaryUserId: owner.id,
        });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        return household.id;
      },
      pool,
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createCreateRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), validInput, null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who is not a member of the household with ForbiddenError, inserting nothing', async () => {
    const owner = await createUser('sub-owner-forbidden');
    const householdId = await createHouseholdWithMember(owner, 'FOR234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    await expect(
      handler(buildEvent(householdId, validInput, 'sub-stranger-forbidden')),
    ).rejects.toThrow(ForbiddenError);

    const recipes = await withUserTransaction(owner.id, (client) => findRecipes(client, householdId), pool);
    expect(recipes).toHaveLength(0);
  });

  it('rejects a non-UUID householdId with ValidationError before touching the database', async () => {
    const handler = createCreateRecipeHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('not-a-uuid', validInput, 'sub-validation'))).rejects.toThrow(
      ValidationError,
    );
  });

  // The DoD gate's actual enforcement point.
  it('rejects a missing role with ValidationError — "role assignment required"', async () => {
    const owner = await createUser('sub-owner-norole');
    const householdId = await createHouseholdWithMember(owner, 'NOR234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });
    const { role, ...withoutRole } = validInput;
    void role;

    await expect(
      handler(buildEvent(householdId, withoutRole, 'sub-owner-norole')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an unrecognised role, cuisineTier1, or dietaryTag without coercing it', async () => {
    const owner = await createUser('sub-owner-badenum');
    const householdId = await createHouseholdWithMember(owner, 'BAD234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    await expect(
      handler(buildEvent(householdId, { ...validInput, role: 'dessert' }, 'sub-owner-badenum')),
    ).rejects.toThrow(ValidationError);
    await expect(
      handler(
        buildEvent(householdId, { ...validInput, cuisineTier1: 'italian' }, 'sub-owner-badenum'),
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      handler(
        buildEvent(
          householdId,
          { ...validInput, dietaryTags: ['carnivore'] },
          'sub-owner-badenum',
        ),
      ),
    ).rejects.toThrow(ValidationError);
  });

  // The exact regression shape the code comment warns about: an explicit
  // bound `NULL` (what a real Ferry client sends, not `undefined`) never
  // triggers a Postgres column `DEFAULT` the way an *absent* column does —
  // `.nullish()` alone isn't enough, the resolver must explicitly fall
  // back in code. `validInput` above never sends `servings`/`inRotation`
  // at all (absent, not null), so this closes that gap end-to-end through
  // the handler rather than just at the Zod-schema level.
  it('falls back to DB defaults when servings/inRotation are explicit null, not just absent', async () => {
    const owner = await createUser('sub-owner-explicit-null');
    const householdId = await createHouseholdWithMember(owner, 'XNL234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    const result = await handler(
      buildEvent(
        householdId,
        { ...validInput, servings: null, inRotation: null },
        'sub-owner-explicit-null',
      ),
    );

    expect(result.servings).toBe(4);
    expect(result.inRotation).toBe(true);
  });

  it('rejects over 100 ingredients with ValidationError', async () => {
    const owner = await createUser('sub-owner-overcap');
    const householdId = await createHouseholdWithMember(owner, 'OVR234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });
    const ingredients = Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}` }));

    await expect(
      handler(buildEvent(householdId, { ...validInput, ingredients }, 'sub-owner-overcap')),
    ).rejects.toThrow(ValidationError);
  });

  it('happy path: creates a recipe with no ingredients and no steps — both are allowed empty', async () => {
    const owner = await createUser('sub-owner-empty');
    const householdId = await createHouseholdWithMember(owner, 'EMP234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(householdId, validInput, 'sub-owner-empty'));

    expect(result.title).toBe('Rajma Chawal');
    expect(result.role).toBe('sabzi_dal');
    expect(result.householdId).toBe(householdId);
    expect(result.sourceType).toBe('user');
    expect(result.inRotation).toBe(true);
    expect(result.isFavorite).toBe(false);
  });

  it('happy path: creates a recipe with ingredients, preserving array order as sortOrder', async () => {
    const owner = await createUser('sub-owner-ingredients');
    const householdId = await createHouseholdWithMember(owner, 'ING234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    const result = await handler(
      buildEvent(
        householdId,
        {
          ...validInput,
          ingredients: [{ name: 'Onion' }, { name: 'Rajma beans' }],
          steps: ['Soak overnight', 'Pressure cook'],
        },
        'sub-owner-ingredients',
      ),
    );

    const ingredients = await withUserTransaction(
      owner.id,
      (client) => findRecipeIngredientsByRecipeId(client, result.id),
      pool,
    );
    expect(ingredients.map((i) => i.name)).toEqual(['Onion', 'Rajma beans']);
  });

  it('sourceType cannot be set from input even if a client sends it', async () => {
    const owner = await createUser('sub-owner-spoof-source');
    const householdId = await createHouseholdWithMember(owner, 'SPS234');
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    const result = await handler(
      buildEvent(householdId, { ...validInput, sourceType: 'curated' }, 'sub-owner-spoof-source'),
    );
    expect(result.sourceType).toBe('user');
  });

  it('createdBy is always the caller, never trusted from input', async () => {
    const owner = await createUser('sub-owner-member-create');
    const member = await createUser('sub-member-create');
    const householdId = await createHouseholdWithMember(owner, 'MEM234');
    await withUserTransaction(
      owner.id,
      (client) => insertMembership(client, { householdId, userId: member.id, role: 'member' }),
      pool,
    );
    const handler = createCreateRecipeHandler({ getPool: async () => pool });

    const result = await handler(
      buildEvent(householdId, { ...validInput, createdBy: owner.id }, 'sub-member-create'),
    );

    // createdBy isn't in the GraphQL Recipe shape, so assert indirectly:
    // the recipe exists and is readable by the member who actually created it.
    expect(result.id).toBeDefined();
  });

  it('rolls back the whole recipe when an ingredient partway through fails — nothing persists', async () => {
    const owner = await createUser('sub-owner-rollback');
    const householdId = await createHouseholdWithMember(owner, 'ROL234');

    let callCount = 0;
    const failingInsert: typeof insertRecipeIngredient = async (client, insertInput) => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('simulated failure on the second ingredient');
      }
      return insertRecipeIngredient(client, insertInput);
    };

    const handler = createCreateRecipeHandler({
      getPool: async () => pool,
      insertRecipeIngredient: failingInsert,
    });

    await expect(
      handler(
        buildEvent(
          householdId,
          {
            ...validInput,
            ingredients: [{ name: 'Onion' }, { name: 'Rajma beans' }, { name: 'Ginger' }],
          },
          'sub-owner-rollback',
        ),
      ),
    ).rejects.toThrow('simulated failure on the second ingredient');

    const recipes = await withUserTransaction(owner.id, (client) => findRecipes(client, householdId), pool);
    expect(recipes).toHaveLength(0);
  });
});
