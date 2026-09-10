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
import { createClearMenuDayHandler } from './clearMenuDay.js';
import type { ClearMenuDayResolverDeps } from './clearMenuDay.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  menuId: unknown,
  dayOfWeek: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown; dayOfWeek: unknown }> => ({
  arguments: { menuId, dayOfWeek },
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
        } as unknown as AppSyncResolverEvent<{ menuId: unknown; dayOfWeek: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['clearedCount', 'preservedCount'],
    selectionSetGraphQL: '{ clearedCount preservedCount }',
    parentTypeName: 'Mutation',
    fieldName: 'clearMenuDay',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('clearMenuDay resolver (Mutation.clearMenuDay)', () => {
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

  const baseDeps: ClearMenuDayResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-cmd-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'CMD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createClearMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 0, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid menuId', 'not-a-uuid', 0],
    ['explicit null dayOfWeek (non-nullable, must be rejected)', undefined, null],
    ['out-of-range dayOfWeek', undefined, 7],
  ])('rejects invalid input (%s) with ValidationError', async (_label, menuId, dayOfWeek) => {
    const handler = createClearMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(menuId, dayOfWeek, 'sub-cmd-validation'))).rejects.toThrow(ValidationError);
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-cmd-oracle-probe');
    const handler = createClearMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 0, 'sub-cmd-oracle-probe'))).rejects.toThrow(ForbiddenError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-cmd-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'CWD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-cmd-stranger');

    const handler = createClearMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 0, 'sub-cmd-stranger'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('removes every item on the target day except one with madeAt set, reporting both counts correctly', async () => {
    const owner = await createUser('sub-cmd-clear');
    const householdId = await createHouseholdWithOwner(owner, 'CMC234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await addRecipe(owner, householdId);

    // Two unmade items and one made item, all on day 0.
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
      [menuId, recipeId],
    );
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'dinner', 'carb')`,
      [menuId, recipeId],
    );
    const madeResult = await db.adminClient.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role, made_at) VALUES ($1, $2, 0, 'breakfast', 'carb', NOW()) RETURNING id`,
      [menuId, recipeId],
    );
    // A day-1 item must survive untouched.
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', 'carb')`,
      [menuId, recipeId],
    );

    const handler = createClearMenuDayHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 0, 'sub-cmd-clear'));

    expect(result.clearedCount).toBe(2);
    expect(result.preservedCount).toBe(1);

    const remaining = await db.adminClient.query<{ id: string; day_of_week: number }>(
      `SELECT id, day_of_week FROM menu_items WHERE menu_id = $1 ORDER BY day_of_week`,
      [menuId],
    );
    expect(remaining.rows).toHaveLength(2); // made item on day 0 + untouched day-1 item
    expect(remaining.rows.map((r) => r.id)).toContain(madeResult.rows[0]?.id);
  });

  it('an empty day (nothing to clear) returns zero for both counts, no error', async () => {
    const owner = await createUser('sub-cmd-empty');
    const householdId = await createHouseholdWithOwner(owner, 'CME234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createClearMenuDayHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 0, 'sub-cmd-empty'));

    expect(result.clearedCount).toBe(0);
    expect(result.preservedCount).toBe(0);
  });
});
