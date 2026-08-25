import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { insertPantryItem } from '../repositories/pantryRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createPantryHandler } from './pantry.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  householdId: unknown,
  search: unknown,
  category: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; search: unknown; category: unknown }> => ({
  arguments: { householdId, search, category },
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
          search: unknown;
          category: unknown;
        }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Query',
    fieldName: 'pantry',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('pantry resolver (Query.pantry)', () => {
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
    const handler = createPantryHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), undefined, undefined, null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who is not a member of the household with ForbiddenError', async () => {
    const owner = await createUser('sub-owner-forbidden');
    const householdId = await createHouseholdWithMember(owner, 'PAN234');

    const handler = createPantryHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, undefined, undefined, 'sub-stranger-forbidden')),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws the identical ForbiddenError message for a nonexistent household as for a real one the caller is not a member of', async () => {
    const owner = await createUser('sub-owner-oracle');
    const householdId = await createHouseholdWithMember(owner, 'ORP234');
    const handler = createPantryHandler({ getPool: async () => pool });

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
    const handler = createPantryHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent('not-a-uuid', undefined, undefined, 'sub-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('happy path: a member sees their household\'s pantry items', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    await withUserTransaction(
      owner.id,
      (client) =>
        insertPantryItem(client, {
          householdId,
          name: 'Toor Dal',
          quantity: 2,
          unit: 'kg',
          category: 'dal',
          isStaple: true,
          expiryDate: null,
          lowThreshold: null,
          addedBy: owner.id,
        }),
      pool,
    );

    const handler = createPantryHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, undefined, undefined, 'sub-owner-happy'));

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Toor Dal');
    expect(result[0]?.addedBy).toBe(owner.id);
  });

  it('applies search and category filters together', async () => {
    const owner = await createUser('sub-owner-filter');
    const householdId = await createHouseholdWithMember(owner, 'FIL234');
    const addItem = (name: string, category: string): Promise<unknown> =>
      withUserTransaction(
        owner.id,
        (client) =>
          insertPantryItem(client, {
            householdId,
            name,
            quantity: 1,
            unit: 'kg',
            category,
            isStaple: false,
            expiryDate: null,
            lowThreshold: null,
            addedBy: owner.id,
          }),
        pool,
      );
    await addItem('Toor Dal', 'dal');
    await addItem('Chana Dal', 'other');
    await addItem('Basmati Rice', 'grain');

    const handler = createPantryHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, 'dal', 'dal', 'sub-owner-filter'));

    expect(result.map((item) => item.name)).toEqual(['Toor Dal']);
  });
});
