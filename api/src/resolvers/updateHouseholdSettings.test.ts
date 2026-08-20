import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createUpdateHouseholdSettingsHandler } from './updateHouseholdSettings.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

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
    selectionSetList: ['householdId'],
    selectionSetGraphQL: '{ householdId }',
    parentTypeName: 'Mutation',
    fieldName: 'updateHouseholdSettings',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('updateHouseholdSettings resolver', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 60_000);

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

  const createHousehold = async (owner: UserRow, inviteCode: string): Promise<string> =>
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

  // --- 1. authorization/denial ---

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), { allergens: ['peanuts'] }, null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who is not a member of the household with ForbiddenError, making zero changes', async () => {
    const owner = await createUser('sub-owner-forbidden');
    const householdId = await createHousehold(owner, 'FOR234');

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, { allergens: ['peanuts'] }, 'sub-stranger-forbidden')),
    ).rejects.toThrow(ForbiddenError);

    const settings = await withUserTransaction(
      owner.id,
      (client) =>
        client.query('SELECT allergens FROM household_settings WHERE household_id = $1', [householdId]),
      pool,
    );
    expect(settings.rows[0].allergens).toEqual([]);
  });

  it('throws the identical ForbiddenError message for a nonexistent household as for a real one the caller is not a member of', async () => {
    const owner = await createUser('sub-owner-oracle');
    const householdId = await createHousehold(owner, 'ORA234');

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });

    let realHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(householdId, { allergens: ['peanuts'] }, 'sub-stranger-oracle'));
    } catch (error) {
      realHouseholdError = error as Error;
    }

    let fakeHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), { allergens: ['peanuts'] }, 'sub-stranger-oracle'));
    } catch (error) {
      fakeHouseholdError = error as Error;
    }

    expect(realHouseholdError).toBeInstanceOf(ForbiddenError);
    expect(fakeHouseholdError).toBeInstanceOf(ForbiddenError);
    expect(realHouseholdError?.message).toBe(fakeHouseholdError?.message);
  });

  // --- 2. Zod validation ---

  it('rejects a non-UUID householdId with ValidationError before touching the database', async () => {
    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent('not-a-uuid', { allergens: ['peanuts'] }, 'sub-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an input with every field absent with ValidationError', async () => {
    const owner = await createUser('sub-owner-empty-patch');
    const householdId = await createHousehold(owner, 'EMP234');

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, {}, 'sub-owner-empty-patch')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an explicit null for a field with ValidationError', async () => {
    const owner = await createUser('sub-owner-null-field');
    const householdId = await createHousehold(owner, 'NUL234');

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, { allergens: null }, 'sub-owner-null-field')),
    ).rejects.toThrow(ValidationError);
  });

  // --- 3. happy path ---

  it('happy path: updates only the provided fields as a member (primary role)', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHousehold(owner, 'HAP234');

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    const result = await handler(
      buildEvent(householdId, { allergens: ['peanuts', 'shellfish'] }, 'sub-owner-happy'),
    );

    expect(result.allergens).toEqual(['peanuts', 'shellfish']);
    expect(result.mealsEnabled).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('happy path: a non-primary member can also update settings', async () => {
    const owner = await createUser('sub-owner-member-update');
    const member = await createUser('sub-member-update');
    const householdId = await createHousehold(owner, 'MEM234');
    await withUserTransaction(
      owner.id,
      (client) => insertMembership(client, { householdId, userId: member.id, role: 'member' }),
      pool,
    );

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    const result = await handler(
      buildEvent(householdId, { skipIngredients: ['cilantro'] }, 'sub-member-update'),
    );
    expect(result.skipIngredients).toEqual(['cilantro']);
  });

  it('accepts and round-trips a mealStructure AWSJSON string', async () => {
    const owner = await createUser('sub-owner-json');
    const householdId = await createHousehold(owner, 'JSN234');

    const handler = createUpdateHouseholdSettingsHandler({ getPool: async () => pool });
    const result = await handler(
      buildEvent(
        householdId,
        { mealStructure: JSON.stringify({ lunch: { carb: 2, sabzi_dal: 1, accompaniment: 0 } }) },
        'sub-owner-json',
      ),
    );
    expect(JSON.parse(result.mealStructure)).toEqual({
      lunch: { carb: 2, sabzi_dal: 1, accompaniment: 0 },
    });
  });

  // --- 4. edge cases ---

  it('returns NotFoundError if the settings row is missing despite passing requireHouseholdMember (defensive branch)', async () => {
    const owner = await createUser('sub-owner-defensive');
    const householdId = await createHousehold(owner, 'DEF234');

    const handler = createUpdateHouseholdSettingsHandler({
      getPool: async () => pool,
      updateSettingsPartial: async () => null,
    });

    await expect(
      handler(buildEvent(householdId, { allergens: ['peanuts'] }, 'sub-owner-defensive')),
    ).rejects.toThrow();
  });
});
