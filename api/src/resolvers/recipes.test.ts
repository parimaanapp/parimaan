import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createRecipesHandler } from './recipes.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  householdId: unknown,
  role: unknown,
  isFavorite: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; role: unknown; isFavorite: unknown }> => ({
  arguments: { householdId, role, isFavorite },
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
        } as unknown as AppSyncResolverEvent<{
          householdId: unknown;
          role: unknown;
          isFavorite: unknown;
        }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Query',
    fieldName: 'recipes',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('recipes resolver (Query.recipes)', () => {
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

  const insertRecipe = async (
    householdId: string,
    createdBy: string,
    overrides: { title?: string; role?: string } = {},
  ): Promise<void> => {
    // RLS-protected — must go through `withUserTransaction` so
    // `parimaan.user_id` is set for the INSERT's `WITH CHECK` to evaluate
    // against, exactly like `pantryRepository.test.ts`'s `asUser` helper.
    // A raw `pool.connect()` client here fails with "invalid input syntax
    // for type uuid: ''" — `current_setting('parimaan.user_id')` on a
    // connection that never ran through `withUserTransaction` evaluates to
    // an empty string, not NULL, which the policy's `::UUID` cast rejects.
    await withUserTransaction(
      createdBy,
      (client) =>
        client.query(
          `INSERT INTO recipes (household_id, source_type, title, role, created_by) VALUES ($1, 'user', $2, $3, $4)`,
          [householdId, overrides.title ?? 'Rajma', overrides.role ?? 'sabzi_dal', createdBy],
        ),
      pool,
    );
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createRecipesHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), undefined, undefined, null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who is not a member of the household with ForbiddenError', async () => {
    const owner = await createUser('sub-owner-forbidden');
    const householdId = await createHouseholdWithMember(owner, 'REC234');

    const handler = createRecipesHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, undefined, undefined, 'sub-stranger-forbidden')),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws the identical ForbiddenError message for a nonexistent household as for a real one the caller is not a member of', async () => {
    const owner = await createUser('sub-owner-oracle');
    const householdId = await createHouseholdWithMember(owner, 'ORQ234');
    const handler = createRecipesHandler({ getPool: async () => pool });

    let realHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(householdId, undefined, undefined, 'sub-stranger-oracle'));
    } catch (error) {
      realHouseholdError = error as Error;
    }

    let fakeHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), undefined, undefined, 'sub-stranger-oracle'));
    } catch (error) {
      fakeHouseholdError = error as Error;
    }

    expect(realHouseholdError).toBeInstanceOf(ForbiddenError);
    expect(fakeHouseholdError).toBeInstanceOf(ForbiddenError);
    expect(realHouseholdError?.message).toBe(DENIAL_MESSAGE);
    expect(realHouseholdError?.message).toBe(fakeHouseholdError?.message);
  });

  it('rejects a non-UUID householdId with ValidationError before touching the database', async () => {
    const handler = createRecipesHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent('not-a-uuid', undefined, undefined, 'sub-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an unrecognised role with ValidationError', async () => {
    const owner = await createUser('sub-owner-badrole');
    const householdId = await createHouseholdWithMember(owner, 'BAD234');
    const handler = createRecipesHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, 'dessert', undefined, 'sub-owner-badrole')),
    ).rejects.toThrow(ValidationError);
  });

  it("happy path: a member sees their household's recipes, favorite-first then by title", async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    await insertRecipe(householdId, owner.id, { title: 'Rajma' });
    await insertRecipe(householdId, owner.id, { title: 'Aloo Gobi' });

    const handler = createRecipesHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, undefined, undefined, 'sub-owner-happy'));

    expect(result.map((r) => r.title)).toEqual(['Aloo Gobi', 'Rajma']);
    expect(result[0]?.householdId).toBe(householdId);
  });

  it('applies the role filter', async () => {
    const owner = await createUser('sub-owner-filter');
    const householdId = await createHouseholdWithMember(owner, 'FIL234');
    await insertRecipe(householdId, owner.id, { title: 'Rajma', role: 'sabzi_dal' });
    await insertRecipe(householdId, owner.id, { title: 'Poha', role: 'breakfast' });

    const handler = createRecipesHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, 'breakfast', undefined, 'sub-owner-filter'));

    expect(result.map((r) => r.title)).toEqual(['Poha']);
  });

  it('does not include an ingredients key on the returned objects — a separate field resolver hydrates it', async () => {
    const owner = await createUser('sub-owner-no-ingredients');
    const householdId = await createHouseholdWithMember(owner, 'NOI234');
    await insertRecipe(householdId, owner.id);

    const handler = createRecipesHandler({ getPool: async () => pool });
    const result = await handler(
      buildEvent(householdId, undefined, undefined, 'sub-owner-no-ingredients'),
    );

    expect(result[0]).not.toHaveProperty('ingredients');
  });

  // Regression: the exact W5 §11.5.5 bug shape, exercised end-to-end
  // through the resolver, not just the schema in isolation.
  it('treats an explicit null role/isFavorite the same as an absent one — not a ValidationError', async () => {
    const owner = await createUser('sub-owner-null-filter');
    const householdId = await createHouseholdWithMember(owner, 'NUL234');
    await insertRecipe(householdId, owner.id);

    const handler = createRecipesHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, null, null, 'sub-owner-null-filter'));

    expect(result).toHaveLength(1);
  });
});
