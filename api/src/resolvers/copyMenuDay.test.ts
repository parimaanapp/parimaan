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
import { createCopyMenuDayHandler } from './copyMenuDay.js';
import type { CopyMenuDayResolverDeps } from './copyMenuDay.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  menuId: unknown,
  fromDay: unknown,
  toDay: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown; fromDay: unknown; toDay: unknown }> => ({
  arguments: { menuId, fromDay, toDay },
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
        } as unknown as AppSyncResolverEvent<{ menuId: unknown; fromDay: unknown; toDay: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['menu', 'copiedCount', 'skippedCount'],
    selectionSetGraphQL: '{ menu { id items { id } } copiedCount skippedCount }',
    parentTypeName: 'Mutation',
    fieldName: 'copyMenuDay',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('copyMenuDay resolver (Mutation.copyMenuDay)', () => {
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

  const baseDeps: CopyMenuDayResolverDeps = { getPool: async () => pool };

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

  const addRecipe = async (
    owner: UserRow,
    householdId: string,
    overrides: { title?: string; role?: string } = {},
  ): Promise<string> =>
    withUserTransaction(
      owner.id,
      (client) =>
        insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title: overrides.title ?? 'Rajma',
          description: null,
          servings: 4,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: overrides.role ?? 'carb',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        }),
      pool,
    ).then((recipe) => recipe.id);

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-cpd-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'CPD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createCopyMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 0, 1, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid menuId', 'not-a-uuid', 0, 1],
    ['explicit null fromDay (non-nullable, must be rejected)', undefined, null, 1],
    ['explicit null toDay (non-nullable, must be rejected)', undefined, 0, null],
    ['out-of-range toDay', undefined, 0, 9],
  ])('rejects invalid input (%s) with ValidationError', async (_label, menuId, fromDay, toDay) => {
    const handler = createCopyMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(menuId, fromDay, toDay, 'sub-cpd-validation'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-cpd-oracle-probe');
    const handler = createCopyMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 0, 1, 'sub-cpd-oracle-probe'))).rejects.toThrow(ForbiddenError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-cpd-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'CPWD34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-cpd-stranger');

    const handler = createCopyMenuDayHandler(baseDeps);
    await expect(handler(buildEvent(menuId, 0, 1, 'sub-cpd-stranger'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('places source day items onto the target day, counted in copiedCount', async () => {
    const owner = await createUser('sub-cpd-copy');
    const householdId = await createHouseholdWithOwner(owner, 'CPDC34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await addRecipe(owner, householdId);

    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
      [menuId, recipeId],
    );

    const handler = createCopyMenuDayHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 0, 1, 'sub-cpd-copy'));

    expect(result.copiedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.menu.items).toHaveLength(2);
    const day1Items = result.menu.items.filter((i) => i.dayOfWeek === 1);
    expect(day1Items).toHaveLength(1);
  });

  it('skips (and counts) a source item that does not fit the target — a cap conflict — never aborting the whole copy', async () => {
    const owner = await createUser('sub-cpd-cap');
    const householdId = await createHouseholdWithOwner(owner, 'CPDK34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeA = await addRecipe(owner, householdId, { title: 'A' });
    const recipeB = await addRecipe(owner, householdId, { title: 'B' });

    // Source day 0 has one carb/lunch item.
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
      [menuId, recipeA],
    );
    // Target day 1 already has carb/lunch cap (1) occupied.
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', 'carb')`,
      [menuId, recipeB],
    );

    const handler = createCopyMenuDayHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 0, 1, 'sub-cpd-cap'));

    expect(result.copiedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    // The pre-existing target item is untouched, never overwritten.
    const day1Items = result.menu.items.filter((i) => i.dayOfWeek === 1);
    expect(day1Items).toHaveLength(1);
    expect(day1Items[0]?.recipe.title).toBe('B');
  });

  it('never overwrites a cooked target slot — the target item survives, source item is skipped', async () => {
    const owner = await createUser('sub-cpd-cooked');
    const householdId = await createHouseholdWithOwner(owner, 'CPDM34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeA = await addRecipe(owner, householdId, { title: 'A' });
    const recipeB = await addRecipe(owner, householdId, { title: 'B' });

    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
      [menuId, recipeA],
    );
    const madeResult = await db.adminClient.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role, made_at) VALUES ($1, $2, 1, 'lunch', 'carb', NOW()) RETURNING id`,
      [menuId, recipeB],
    );

    const handler = createCopyMenuDayHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 0, 1, 'sub-cpd-cooked'));

    expect(result.copiedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    const day1Items = result.menu.items.filter((i) => i.dayOfWeek === 1);
    expect(day1Items).toHaveLength(1);
    expect(day1Items[0]?.id).toBe(madeResult.rows[0]?.id);
  });

  it('an empty source day copies nothing, no error', async () => {
    const owner = await createUser('sub-cpd-empty');
    const householdId = await createHouseholdWithOwner(owner, 'CPDE34');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createCopyMenuDayHandler(baseDeps);
    const result = await handler(buildEvent(menuId, 0, 1, 'sub-cpd-empty'));

    expect(result.copiedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });
});
