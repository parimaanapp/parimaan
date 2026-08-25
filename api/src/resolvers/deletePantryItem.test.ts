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
import { createDeletePantryItemHandler } from './deletePantryItem.js';
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
    fieldName: 'deletePantryItem',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('deletePantryItem resolver', () => {
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

  const createItem = (owner: UserRow, householdId: string): Promise<{ id: string }> =>
    withUserTransaction(
      owner.id,
      (client) =>
        insertPantryItem(client, {
          householdId,
          name: 'Toor Dal',
          quantity: 1,
          unit: 'kg',
          category: 'dal',
          isStaple: false,
          expiryDate: null,
          lowThreshold: null,
          addedBy: owner.id,
        }),
      pool,
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createDeletePantryItemHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-UUID id with ValidationError', async () => {
    const handler = createDeletePantryItemHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('not-a-uuid', 'sub-validation'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws NotFoundError for a nonexistent id', async () => {
    await createUser('sub-owner-missing');
    const handler = createDeletePantryItemHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), 'sub-owner-missing'))).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws the identical NotFoundError message for an item in another household as for a nonexistent id, deleting nothing', async () => {
    const owner = await createUser('sub-owner-oracle');
    const outsider = 'sub-outsider-oracle';
    const householdId = await createHouseholdWithMember(owner, 'ORQ234');
    const item = await createItem(owner, householdId);
    const handler = createDeletePantryItemHandler({ getPool: async () => pool });

    let wrongHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(item.id, outsider));
    } catch (error) {
      wrongHouseholdError = error as Error;
    }

    let nonexistentError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), outsider));
    } catch (error) {
      nonexistentError = error as Error;
    }

    expect(wrongHouseholdError).toBeInstanceOf(NotFoundError);
    expect(nonexistentError).toBeInstanceOf(NotFoundError);
    expect(wrongHouseholdError?.message).toBe(nonexistentError?.message);

    const stillThere = await withUserTransaction(
      owner.id,
      (client) => client.query('SELECT 1 FROM pantry_items WHERE id = $1', [item.id]),
      pool,
    );
    expect(stillThere.rows).toHaveLength(1);
  });

  it('happy path: deletes the item and returns the deleted row', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    const item = await createItem(owner, householdId);
    const handler = createDeletePantryItemHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(item.id, 'sub-owner-happy'));
    expect(result.id).toBe(item.id);
    expect(result.name).toBe('Toor Dal');

    const stillThere = await withUserTransaction(
      owner.id,
      (client) => client.query('SELECT 1 FROM pantry_items WHERE id = $1', [item.id]),
      pool,
    );
    expect(stillThere.rows).toHaveLength(0);
  });

  it('a second delete of the same id throws NotFoundError', async () => {
    const owner = await createUser('sub-owner-twice');
    const householdId = await createHouseholdWithMember(owner, 'TWC234');
    const item = await createItem(owner, householdId);
    const handler = createDeletePantryItemHandler({ getPool: async () => pool });

    await handler(buildEvent(item.id, 'sub-owner-twice'));
    await expect(handler(buildEvent(item.id, 'sub-owner-twice'))).rejects.toThrow(NotFoundError);
  });
});
