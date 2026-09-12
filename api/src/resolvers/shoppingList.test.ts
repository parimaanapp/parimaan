import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createMenu as createMenuRepo } from '../repositories/menuRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createGenerateShoppingListHandler } from './generateShoppingList.js';
import { createShoppingListHandler } from './shoppingList.js';
import type { ShoppingListResolverDeps } from './shoppingList.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const identityFor = (cognitoSub: string | null): AppSyncResolverEvent<unknown>['identity'] =>
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
      } as unknown as AppSyncResolverEvent<unknown>['identity']);

const buildEvent = (
  menuId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown }> => ({
  arguments: { menuId },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'items'],
    selectionSetGraphQL: '{ id items { id name } }',
    parentTypeName: 'Query',
    fieldName: 'shoppingList',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('shoppingList resolver (Query.shoppingList)', () => {
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

  const baseDeps: ShoppingListResolverDeps = { getPool: async () => pool };

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

  const createHouseholdWithOwner = async (owner: UserRow, inviteCode: string): Promise<string> =>
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

  const createMenuFor = async (owner: UserRow, householdId: string, weekStartDate: string): Promise<string> =>
    withUserTransaction(owner.id, (client) => createMenuRepo(client, householdId, weekStartDate), pool).then(
      (menu) => menu.id,
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-qsl-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'QSL001');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['explicit null', null],
  ])('rejects a %s menuId with ValidationError', async (_label, menuId) => {
    const handler = createShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 'sub-qsl-validation'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-qsl-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'QSL002');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-qsl-stranger-denial');

    const handler = createShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 'sub-qsl-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(menuId, 'sub-qsl-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-qsl-oracle');
    const handler = createShoppingListHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-qsl-oracle'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-qsl-oracle'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('returns null (not an error) when no list has been generated yet for the menu', async () => {
    const owner = await createUser('sub-qsl-none');
    const householdId = await createHouseholdWithOwner(owner, 'QSL003');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-qsl-none'));

    expect(result).toBeNull();
  });

  it('returns the real, already-generated list (with its real items), not a re-derived one', async () => {
    const owner = await createUser('sub-qsl-existing');
    const householdId = await createHouseholdWithOwner(owner, 'QSL004');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const generateHandler = createGenerateShoppingListHandler({ getPool: async () => pool });
    const generated = await generateHandler(buildEvent(menuId, 'sub-qsl-existing'));

    const handler = createShoppingListHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-qsl-existing'));

    expect(result).not.toBeNull();
    expect(result?.id).toBe(generated.id);
    expect(result?.householdId).toBe(householdId);
    expect(result?.generatedFromMenuId).toBe(menuId);
    expect(result?.items).toEqual(generated.items);
  });
});
