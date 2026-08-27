import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createRecipeIngredientsHandler } from './recipeIngredients.js';
import { UnauthorizedError } from '../errors.js';

type Source = { id: string };

const buildEvent = (
  source: Source,
  cognitoSub: string | null,
): AppSyncResolverEvent<Record<string, never>, Source> => ({
  arguments: {},
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
        } as unknown as AppSyncResolverEvent<Record<string, never>>['identity']),
  source,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Recipe',
    fieldName: 'ingredients',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('Recipe.ingredients field resolver', () => {
  let db: TestDatabase;
  let pool: Pool;
  let handler: ReturnType<typeof createRecipeIngredientsHandler>;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
    handler = createRecipeIngredientsHandler({ getPool: async () => pool });
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

  const insertRecipeWithIngredient = async (
    householdId: string,
    createdBy: string,
    ingredientName = 'Rajma beans',
  ): Promise<string> =>
    // RLS-protected — must go through `withUserTransaction`, same reasoning
    // as `recipes.test.ts`'s identical fixture-helper fix: a raw
    // `pool.connect()` client never sets `parimaan.user_id`, so the
    // INSERT's `WITH CHECK` fails with "invalid input syntax for type
    // uuid: ''" rather than a clean RLS denial.
    withUserTransaction(
      createdBy,
      async (client) => {
        const recipe = await client.query<{ id: string }>(
          `INSERT INTO recipes (household_id, source_type, title, role, created_by) VALUES ($1, 'user', 'Rajma', 'sabzi_dal', $2) RETURNING id`,
          [householdId, createdBy],
        );
        const recipeId = recipe.rows[0]?.id;
        if (recipeId === undefined) {
          throw new Error('Expected an inserted recipe row.');
        }
        await client.query(`INSERT INTO recipe_ingredients (recipe_id, name) VALUES ($1, $2)`, [
          recipeId,
          ingredientName,
        ]);
        return recipeId;
      },
      pool,
    );

  it('throws UnauthorizedError for a null identity', async () => {
    await expect(handler(buildEvent({ id: 'anything' }, null))).rejects.toThrow(UnauthorizedError);
  });

  it("returns a member's own household's ingredients for the parent recipe", async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'ING234');
    const recipeId = await insertRecipeWithIngredient(householdId, owner.id);

    const result = await handler(buildEvent({ id: recipeId }, 'sub-owner-happy'));
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Rajma beans');
  });

  // The single most important test in this slice (E2E_MVP_PLAN.md
  // §12.2.2/§12.5.2): there is no `householdId` argument on this field —
  // RLS alone gates it. A non-member's call for a real recipe in another
  // household must return `[]`, exactly like a recipe with no ingredients,
  // never leak another household's ingredient list.
  it("returns [] for another household's recipe — no householdId to gate on, RLS is the sole guard", async () => {
    const ownerA = await createUser('sub-owner-a');
    const ownerB = await createUser('sub-owner-b');
    const householdA = await createHouseholdWithMember(ownerA, 'AAA234');
    await createHouseholdWithMember(ownerB, 'BBB234');
    const recipeId = await insertRecipeWithIngredient(householdA, ownerA.id);

    const result = await handler(buildEvent({ id: recipeId }, 'sub-owner-b'));
    expect(result).toEqual([]);
  });

  it('returns [] for a nonexistent recipe id — indistinguishable from a non-member call', async () => {
    const owner = await createUser('sub-owner-missing');
    await createHouseholdWithMember(owner, 'MIS234');

    const result = await handler(buildEvent({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, 'sub-owner-missing'));
    expect(result).toEqual([]);
  });
});
