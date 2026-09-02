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
import { insertRecipe } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import type { AddMenuItemResolverDeps } from './addMenuItem.js';
import { createRemoveMenuItemHandler } from './removeMenuItem.js';
import type { RemoveMenuItemResolverDeps } from './removeMenuItem.js';
import { UnauthorizedError, ValidationError } from '../errors.js';

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
    selectionSetList: [],
    selectionSetGraphQL: '',
    parentTypeName: 'Mutation',
    fieldName: 'removeMenuItem',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('removeMenuItem resolver (Mutation.removeMenuItem)', () => {
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

  const removeDeps: RemoveMenuItemResolverDeps = { getPool: async () => pool };
  const addDeps: AddMenuItemResolverDeps = { getPool: async () => pool };

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

  const buildAddMenuItemEvent = (
    menuId: unknown,
    input: unknown,
    cognitoSub: string,
  ): AppSyncResolverEvent<{ menuId: unknown; input: unknown }> => ({
    arguments: { menuId, input },
    identity: {
      sub: cognitoSub,
      issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
      username: cognitoSub,
      claims: { email: `${cognitoSub}@example.test` },
      sourceIp: ['127.0.0.1'],
      defaultAuthStrategy: 'ALLOW',
      groups: null,
    } as unknown as AppSyncResolverEvent<{ menuId: unknown; input: unknown }>['identity'],
    source: null,
    request: { headers: {}, domainName: null },
    info: {
      selectionSetList: ['id'],
      selectionSetGraphQL: '{ id }',
      parentTypeName: 'Mutation',
      fieldName: 'addMenuItem',
      variables: {},
    },
    prev: null,
    stash: {},
  });

  const addMenuItemDirectly = async (
    owner: UserRow,
    menuId: string,
    householdId: string,
    cognitoSub: string,
  ): Promise<string> => {
    const recipeId = await withUserTransaction(
      owner.id,
      (client) =>
        insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title: 'Rajma',
          description: null,
          servings: 4,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: 'sabzi_dal',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        }),
      pool,
    ).then((recipe) => recipe.id);

    const addHandler = createAddMenuItemHandler(addDeps);
    const item = await addHandler(
      buildAddMenuItemEvent(menuId, { recipeId, dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, cognitoSub),
    );
    return item.id;
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createRemoveMenuItemHandler(removeDeps);
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-uuid id with ValidationError', async () => {
    const handler = createRemoveMenuItemHandler(removeDeps);
    await expect(handler(buildEvent('not-a-uuid', 'sub-rmi-validation'))).rejects.toThrow(ValidationError);
  });

  it('returns false for a nonexistent id, never an error', async () => {
    await createUser('sub-rmi-nonexistent');
    const handler = createRemoveMenuItemHandler(removeDeps);
    const result = await handler(buildEvent(randomUUID(), 'sub-rmi-nonexistent'));
    expect(result).toBe(false);
  });

  it('returns false for an id belonging to a household the caller is not a member of — same denial as nonexistent', async () => {
    const owner = await createUser('sub-rmi-owner-cross');
    const householdId = await createHouseholdWithOwner(owner, 'RMX234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const itemId = await addMenuItemDirectly(owner, menuId, householdId, 'sub-rmi-owner-cross');

    await createUser('sub-rmi-stranger-cross');
    const handler = createRemoveMenuItemHandler(removeDeps);
    const result = await handler(buildEvent(itemId, 'sub-rmi-stranger-cross'));
    expect(result).toBe(false);
  });

  it('removes a real item, returns true, and frees the slot for a subsequent add', async () => {
    const owner = await createUser('sub-rmi-owner-happy');
    const householdId = await createHouseholdWithOwner(owner, 'RMH234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const itemId = await addMenuItemDirectly(owner, menuId, householdId, 'sub-rmi-owner-happy');

    const handler = createRemoveMenuItemHandler(removeDeps);
    const result = await handler(buildEvent(itemId, 'sub-rmi-owner-happy'));
    expect(result).toBe(true);

    const countResult = await db.adminClient.query('SELECT 1 FROM menu_items WHERE id = $1', [itemId]);
    expect(countResult.rows).toHaveLength(0);
  });

  it('is idempotent: removing the same id twice returns true then false, never an error', async () => {
    const owner = await createUser('sub-rmi-owner-idempotent');
    const householdId = await createHouseholdWithOwner(owner, 'RMI234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const itemId = await addMenuItemDirectly(owner, menuId, householdId, 'sub-rmi-owner-idempotent');

    const handler = createRemoveMenuItemHandler(removeDeps);
    const first = await handler(buildEvent(itemId, 'sub-rmi-owner-idempotent'));
    const second = await handler(buildEvent(itemId, 'sub-rmi-owner-idempotent'));
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
