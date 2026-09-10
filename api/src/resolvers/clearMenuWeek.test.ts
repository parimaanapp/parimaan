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
import { createClearMenuWeekHandler } from './clearMenuWeek.js';
import type { ClearMenuWeekResolverDeps } from './clearMenuWeek.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  menuId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown }> => ({
  arguments: { menuId },
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
        } as unknown as AppSyncResolverEvent<{ menuId: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['clearedCount', 'preservedCount'],
    selectionSetGraphQL: '{ clearedCount preservedCount }',
    parentTypeName: 'Mutation',
    fieldName: 'clearMenuWeek',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('clearMenuWeek resolver (Mutation.clearMenuWeek)', () => {
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

  const baseDeps: ClearMenuWeekResolverDeps = { getPool: async () => pool };

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

  const addRecipe = async (owner: UserRow, householdId: string, title = 'Rajma'): Promise<string> =>
    withUserTransaction(
      owner.id,
      (client) =>
        insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title,
          description: null,
          servings: 4,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: 'carb',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        }),
      pool,
    ).then((recipe) => recipe.id);

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-cmw-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'CMW234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createClearMenuWeekHandler(baseDeps);
    await expect(handler(buildEvent(menuId, null))).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a non-uuid menuId with ValidationError', async () => {
    const handler = createClearMenuWeekHandler(baseDeps);
    await expect(handler(buildEvent('not-a-uuid', 'sub-cmw-validation'))).rejects.toThrow(ValidationError);
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-cmw-oracle-probe');
    const handler = createClearMenuWeekHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-cmw-oracle-probe'))).rejects.toThrow(ForbiddenError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-cmw-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'CWWD34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-cmw-stranger');

    const handler = createClearMenuWeekHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 'sub-cmw-stranger'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('clears every unmade item across all seven days in one call, preserving made items', async () => {
    const owner = await createUser('sub-cmw-clear');
    const householdId = await createHouseholdWithOwner(owner, 'CMWC34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await addRecipe(owner, householdId);

    // One unmade item per day, days 0-6.
    for (let day = 0; day <= 6; day += 1) {
      await db.adminClient.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, $3, 'lunch', 'carb')`,
        [menuId, recipeId, day],
      );
    }
    // Plus one made item on day 3.
    const madeResult = await db.adminClient.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role, made_at) VALUES ($1, $2, 3, 'dinner', 'carb', NOW()) RETURNING id`,
      [menuId, recipeId],
    );

    const handler = createClearMenuWeekHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-cmw-clear'));

    expect(result.clearedCount).toBe(7);
    expect(result.preservedCount).toBe(1);

    const remaining = await db.adminClient.query<{ id: string }>(`SELECT id FROM menu_items WHERE menu_id = $1`, [
      menuId,
    ]);
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0]?.id).toBe(madeResult.rows[0]?.id);
  });

  it('an already-empty menu (nothing to clear) returns zero for both counts, no error', async () => {
    const owner = await createUser('sub-cmw-empty');
    const householdId = await createHouseholdWithOwner(owner, 'CMWE34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createClearMenuWeekHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 'sub-cmw-empty'));

    expect(result.clearedCount).toBe(0);
    expect(result.preservedCount).toBe(0);
  });
});
