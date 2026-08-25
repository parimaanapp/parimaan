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
import { createUpdatePantryItemHandler } from './updatePantryItem.js';
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
    fieldName: 'updatePantryItem',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('updatePantryItem resolver', () => {
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
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), { quantity: 5 }, null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-UUID id with ValidationError before touching the database', async () => {
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent('not-a-uuid', { quantity: 5 }, 'sub-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an all-absent input with ValidationError', async () => {
    await createUser('sub-owner-empty');
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(randomUUID(), {}, 'sub-owner-empty'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws NotFoundError for a nonexistent id', async () => {
    await createUser('sub-owner-missing');
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), { quantity: 5 }, 'sub-owner-missing')),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws the identical NotFoundError message for an item in another household as for a nonexistent id', async () => {
    const owner = await createUser('sub-owner-oracle');
    const outsider = 'sub-outsider-oracle';
    const householdId = await createHouseholdWithMember(owner, 'ORQ234');
    const item = await createItem(owner, householdId);
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });

    let wrongHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(item.id, { quantity: 5 }, outsider));
    } catch (error) {
      wrongHouseholdError = error as Error;
    }

    let nonexistentError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), { quantity: 5 }, outsider));
    } catch (error) {
      nonexistentError = error as Error;
    }

    expect(wrongHouseholdError).toBeInstanceOf(NotFoundError);
    expect(nonexistentError).toBeInstanceOf(NotFoundError);
    expect(wrongHouseholdError?.message).toBe(nonexistentError?.message);
  });

  it('leaves the item in another household completely unchanged after a denied update', async () => {
    const owner = await createUser('sub-owner-unchanged');
    const householdId = await createHouseholdWithMember(owner, 'UNC234');
    const item = await createItem(owner, householdId);
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });

    await expect(
      handler(buildEvent(item.id, { quantity: 999 }, 'sub-outsider-unchanged')),
    ).rejects.toThrow(NotFoundError);

    const stillOriginal = await withUserTransaction(
      owner.id,
      (client) => client.query('SELECT quantity FROM pantry_items WHERE id = $1', [item.id]),
      pool,
    );
    expect(stillOriginal.rows[0].quantity).toBe('1');
  });

  it('happy path: updates only the provided fields', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');
    const item = await createItem(owner, householdId);
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(item.id, { quantity: 5 }, 'sub-owner-happy'));

    expect(result.quantity).toBe(5);
    expect(result.name).toBe('Toor Dal');
    expect(result.unit).toBe('kg');
  });

  it('canonicalizes a differently-cased known unit on update', async () => {
    const owner = await createUser('sub-owner-canon');
    const householdId = await createHouseholdWithMember(owner, 'CAN234');
    const item = await createItem(owner, householdId);
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(item.id, { unit: 'KG' }, 'sub-owner-canon'));
    expect(result.unit).toBe('kg');
  });

  it('happy path: a non-primary member can also update', async () => {
    const owner = await createUser('sub-owner-member-update');
    const member = await createUser('sub-member-update');
    const householdId = await createHouseholdWithMember(owner, 'MEM234');
    await withUserTransaction(
      owner.id,
      (client) => insertMembership(client, { householdId, userId: member.id, role: 'member' }),
      pool,
    );
    const item = await createItem(owner, householdId);
    const handler = createUpdatePantryItemHandler({ getPool: async () => pool });

    const result = await handler(buildEvent(item.id, { quantity: 3 }, 'sub-member-update'));
    expect(result.quantity).toBe(3);
  });
});
