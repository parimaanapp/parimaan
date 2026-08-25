import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { findPantryItems } from '../repositories/pantryRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createAddPantryItemHandler } from './addPantryItem.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

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
    fieldName: 'addPantryItem',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('addPantryItem resolver', () => {
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

  const validInput = { name: 'Toor Dal', quantity: 2, unit: 'kg' };

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(randomUUID(), validInput, null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who is not a member of the household with ForbiddenError, inserting nothing', async () => {
    const owner = await createUser('sub-owner-forbidden');
    const householdId = await createHouseholdWithMember(owner, 'FOR234');

    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, validInput, 'sub-stranger-forbidden')),
    ).rejects.toThrow(ForbiddenError);

    const items = await withUserTransaction(
      owner.id,
      (client) => findPantryItems(client, householdId),
      pool,
    );
    expect(items).toHaveLength(0);
  });

  it('throws the identical ForbiddenError message for a nonexistent household as for a real one the caller is not a member of', async () => {
    const owner = await createUser('sub-owner-oracle');
    const householdId = await createHouseholdWithMember(owner, 'ORA234');
    const handler = createAddPantryItemHandler({ getPool: async () => pool });

    let realHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(householdId, validInput, 'sub-stranger-oracle'));
    } catch (error) {
      realHouseholdError = error as Error;
    }

    let fakeHouseholdError: Error | undefined;
    try {
      await handler(buildEvent(randomUUID(), validInput, 'sub-stranger-oracle'));
    } catch (error) {
      fakeHouseholdError = error as Error;
    }

    expect(realHouseholdError?.message).toBe(DENIAL_MESSAGE);
    expect(realHouseholdError?.message).toBe(fakeHouseholdError?.message);
  });

  it('rejects a non-UUID householdId with ValidationError before touching the database', async () => {
    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent('not-a-uuid', validInput, 'sub-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a blank name with ValidationError', async () => {
    const owner = await createUser('sub-owner-blank');
    const householdId = await createHouseholdWithMember(owner, 'BLK234');
    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, { ...validInput, name: '' }, 'sub-owner-blank')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a negative quantity with ValidationError', async () => {
    const owner = await createUser('sub-owner-neg');
    const householdId = await createHouseholdWithMember(owner, 'NEG234');
    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    await expect(
      handler(buildEvent(householdId, { ...validInput, quantity: -1 }, 'sub-owner-neg')),
    ).rejects.toThrow(ValidationError);
  });

  it('happy path: a member adds a pantry item, addedBy taken from the caller identity', async () => {
    const owner = await createUser('sub-owner-happy');
    const householdId = await createHouseholdWithMember(owner, 'HAP234');

    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, validInput, 'sub-owner-happy'));

    expect(result.name).toBe('Toor Dal');
    expect(result.quantity).toBe(2);
    expect(result.unit).toBe('kg');
    expect(result.addedBy).toBe(owner.id);
    expect(result.isStaple).toBe(false);
  });

  it('happy path: a non-primary member can also add a pantry item', async () => {
    const owner = await createUser('sub-owner-member-add');
    const member = await createUser('sub-member-add');
    const householdId = await createHouseholdWithMember(owner, 'MEM234');
    await withUserTransaction(
      owner.id,
      (client) => insertMembership(client, { householdId, userId: member.id, role: 'member' }),
      pool,
    );

    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    const result = await handler(buildEvent(householdId, validInput, 'sub-member-add'));
    expect(result.addedBy).toBe(member.id);
  });

  it('canonicalizes a differently-cased known unit and category on insert', async () => {
    const owner = await createUser('sub-owner-canon');
    const householdId = await createHouseholdWithMember(owner, 'CAN234');
    const handler = createAddPantryItemHandler({ getPool: async () => pool });

    const result = await handler(
      buildEvent(householdId, { ...validInput, unit: 'KG', category: 'DAL' }, 'sub-owner-canon'),
    );
    expect(result.unit).toBe('kg');
    expect(result.category).toBe('dal');
  });

  it('an addedBy value in the raw event arguments is ignored — never trusted from the client', async () => {
    const owner = await createUser('sub-owner-spoof');
    const attacker = await createUser('sub-attacker-spoof');
    const householdId = await createHouseholdWithMember(owner, 'SPF234');
    await withUserTransaction(
      owner.id,
      (client) => insertMembership(client, { householdId, userId: attacker.id, role: 'member' }),
      pool,
    );

    const handler = createAddPantryItemHandler({ getPool: async () => pool });
    const result = await handler(
      buildEvent(
        householdId,
        { ...validInput, addedBy: owner.id },
        'sub-attacker-spoof',
      ),
    );
    expect(result.addedBy).toBe(attacker.id);
    expect(result.addedBy).not.toBe(owner.id);
  });
});
