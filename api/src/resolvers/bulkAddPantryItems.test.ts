import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { findPantryItems, insertPantryItem } from '../repositories/pantryRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createBulkAddPantryItemsHandler } from './bulkAddPantryItems.js';
import { MAX_BULK_PANTRY_ITEMS } from '../validation/bulkAddPantryItems.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const buildEvent = (
  householdId: unknown,
  items: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; items: unknown }> => ({
  arguments: { householdId, items },
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
        } as unknown as AppSyncResolverEvent<{ householdId: unknown; items: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'bulkAddPantryItems',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('bulkAddPantryItems resolver', () => {
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

  const item = (name: string): { name: string; quantity: number; unit: string } => ({
    name,
    quantity: 1,
    unit: 'kg',
  });

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createBulkAddPantryItemsHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), [item('Dal')], null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who is not a member with ForbiddenError, inserting nothing', async () => {
    const owner = await createUser('sub-owner-forbidden');
    const householdId = await createHouseholdWithMember(owner, 'FOR234');
    const handler = createBulkAddPantryItemsHandler({ getPool: async () => pool });

    await expect(
      handler(buildEvent(householdId, [item('Dal')], 'sub-stranger-forbidden')),
    ).rejects.toThrow(ForbiddenError);

    const items = await withUserTransaction(
      owner.id,
      (client) => findPantryItems(client, householdId),
      pool,
    );
    expect(items).toHaveLength(0);
  });

  it('rejects an items array over the cap with ValidationError', async () => {
    const owner = await createUser('sub-owner-cap');
    const householdId = await createHouseholdWithMember(owner, 'CAP234');
    const handler = createBulkAddPantryItemsHandler({ getPool: async () => pool });
    const items = Array.from({ length: MAX_BULK_PANTRY_ITEMS + 1 }, (_, i) => item(`Item ${i}`));

    await expect(handler(buildEvent(householdId, items, 'sub-owner-cap'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects an empty items array with ValidationError', async () => {
    const owner = await createUser('sub-owner-empty');
    const householdId = await createHouseholdWithMember(owner, 'EMP234');
    const handler = createBulkAddPantryItemsHandler({ getPool: async () => pool });

    await expect(handler(buildEvent(householdId, [], 'sub-owner-empty'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('happy path: inserts every item, addedBy taken from the caller identity', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    const handler = createBulkAddPantryItemsHandler({ getPool: async () => pool });

    const result = await handler(
      buildEvent(householdId, [item('Toor Dal'), item('Chana Dal')], 'sub-owner-happy'),
    );

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.name)).toEqual(['Toor Dal', 'Chana Dal']);
    for (const row of result) {
      expect(row.addedBy).toBe(owner.id);
    }
  });

  it('rolls back the whole batch when an item partway through fails — nothing persists', async () => {
    const owner = await createUser('sub-owner-rollback');
    const householdId = await createHouseholdWithMember(owner, 'ROL234');

    let callCount = 0;
    const failingInsert: typeof insertPantryItem = async (client, insertInput) => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error('simulated failure on the second item');
      }
      return insertPantryItem(client, insertInput);
    };

    const handler = createBulkAddPantryItemsHandler({
      getPool: async () => pool,
      insertPantryItem: failingInsert,
    });

    await expect(
      handler(
        buildEvent(
          householdId,
          [item('Toor Dal'), item('Chana Dal'), item('Rice')],
          'sub-owner-rollback',
        ),
      ),
    ).rejects.toThrow('simulated failure on the second item');

    const items = await withUserTransaction(
      owner.id,
      (client) => findPantryItems(client, householdId),
      pool,
    );
    expect(items).toHaveLength(0);
  });
});
