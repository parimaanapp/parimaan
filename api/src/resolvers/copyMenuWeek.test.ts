import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import {
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  updateSettingsPartial,
} from '../repositories/householdRepository.js';
import { createMenu as createMenuRepo, findMenuByWeek } from '../repositories/menuRepository.js';
import { insertRecipe } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createCopyMenuWeekHandler } from './copyMenuWeek.js';
import type { CopyMenuWeekResolverDeps } from './copyMenuWeek.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  fromMenuId: unknown,
  toWeekStartDate: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ fromMenuId: unknown; toWeekStartDate: unknown }> => ({
  arguments: { fromMenuId, toWeekStartDate },
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
          fromMenuId: unknown;
          toWeekStartDate: unknown;
        }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['menu', 'copiedCount', 'skippedCount'],
    selectionSetGraphQL: '{ menu { id mealConfigSnapshot items { id } } copiedCount skippedCount }',
    parentTypeName: 'Mutation',
    fieldName: 'copyMenuWeek',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('copyMenuWeek resolver (Mutation.copyMenuWeek)', () => {
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

  const baseDeps: CopyMenuWeekResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-cpw-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'CPW234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createCopyMenuWeekHandler(baseDeps);
    await expect(handler(buildEvent(menuId, '2026-09-14T00:00:00.000Z', null))).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it.each([
    ['not a uuid fromMenuId', 'not-a-uuid', '2026-09-14T00:00:00.000Z'],
    ['explicit null toWeekStartDate (non-nullable, must be rejected)', undefined, null],
    ['malformed toWeekStartDate', undefined, 'not-a-date'],
  ])('rejects invalid input (%s) with ValidationError', async (_label, fromMenuId, toWeekStartDate) => {
    const handler = createCopyMenuWeekHandler(baseDeps);
    await expect(
      handler(buildEvent(fromMenuId, toWeekStartDate, 'sub-cpw-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('gives a nonexistent fromMenuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-cpw-oracle-probe');
    const handler = createCopyMenuWeekHandler(baseDeps);
    await expect(
      handler(buildEvent(randomUUID(), '2026-09-14T00:00:00.000Z', 'sub-cpw-oracle-probe')),
    ).rejects.toThrow(ForbiddenError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-cpw-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'CPWWD4');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-cpw-stranger');

    const handler = createCopyMenuWeekHandler(baseDeps);
    await expect(
      handler(buildEvent(menuId, '2026-09-14T00:00:00.000Z', 'sub-cpw-stranger')),
    ).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('against a NON-existent target week, creates that week\'s menu first with its OWN independent snapshot — not the source week\'s', async () => {
    const owner = await createUser('sub-cpw-newweek');
    const householdId = await createHouseholdWithOwner(owner, 'CPWN34');

    const sourceMenuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await addRecipe(owner, householdId);
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
      [sourceMenuId, recipeId],
    );

    // Change LIVE household settings AFTER the source menu was created but
    // BEFORE copyMenuWeek runs — the target's snapshot must reflect THIS
    // live value, not the source menu's already-frozen one.
    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealStructure: { lunch: { carb: 3 } } }),
      pool,
    );

    // Confirm the source's own snapshot did NOT change (it's frozen).
    const sourceMenuBefore = await withUserTransaction(
      owner.id,
      (client) => findMenuByWeek(client, householdId, '2026-09-07'),
      pool,
    );
    const sourceStructure = sourceMenuBefore?.mealConfigSnapshot.mealStructure as {
      lunch?: { carb?: number };
    };
    expect(sourceStructure?.lunch?.carb).not.toBe(3);

    const handler = createCopyMenuWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(sourceMenuId, '2026-09-14T00:00:00.000Z', 'sub-cpw-newweek'),
    );

    // The target's own snapshot reflects the LIVE value at copy time (3),
    // not whatever the source menu's frozen snapshot held.
    const targetStructure = result.menu.mealConfigSnapshot.mealStructure as { lunch?: { carb?: number } };
    expect(targetStructure?.lunch?.carb).toBe(3);
    expect(result.menu.mealConfigSnapshot).not.toEqual(sourceMenuBefore?.mealConfigSnapshot);
    expect(result.menu.weekStartDate).toBe('2026-09-14T00:00:00.000Z');
    expect(result.copiedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it('against an EXISTING target week, follows the cooked-item-never-touched rule across all seven days', async () => {
    const owner = await createUser('sub-cpw-existing');
    const householdId = await createHouseholdWithOwner(owner, 'CPWE34');

    const sourceMenuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const targetMenuId = await createMenuFor(owner, householdId, '2026-09-14T00:00:00.000Z');
    const recipeA = await addRecipe(owner, householdId, { title: 'A' });
    const recipeB = await addRecipe(owner, householdId, { title: 'B' });

    // Source has items on days 0 and 3.
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 0, 'lunch', 'carb')`,
      [sourceMenuId, recipeA],
    );
    await db.adminClient.query(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 3, 'lunch', 'carb')`,
      [sourceMenuId, recipeA],
    );
    // Target day 3's lunch/carb slot is already cooked — must survive.
    const madeResult = await db.adminClient.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role, made_at) VALUES ($1, $2, 3, 'lunch', 'carb', NOW()) RETURNING id`,
      [targetMenuId, recipeB],
    );

    const handler = createCopyMenuWeekHandler(baseDeps);
    const result = await handler(
      buildEvent(sourceMenuId, '2026-09-14T00:00:00.000Z', 'sub-cpw-existing'),
    );

    expect(result.menu.id).toBe(targetMenuId);
    expect(result.copiedCount).toBe(1); // day 0's item
    expect(result.skippedCount).toBe(1); // day 3's item, blocked by the cooked slot

    const day3Items = result.menu.items.filter((i) => i.dayOfWeek === 3);
    expect(day3Items).toHaveLength(1);
    expect(day3Items[0]?.id).toBe(madeResult.rows[0]?.id);
  });

  it('is idempotent about the target menu row — calling twice never creates a second menu for the same week', async () => {
    const owner = await createUser('sub-cpw-idempotent');
    const householdId = await createHouseholdWithOwner(owner, 'CPWI34');
    const sourceMenuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createCopyMenuWeekHandler(baseDeps);
    const first = await handler(buildEvent(sourceMenuId, '2026-09-14T00:00:00.000Z', 'sub-cpw-idempotent'));
    const second = await handler(buildEvent(sourceMenuId, '2026-09-14T00:00:00.000Z', 'sub-cpw-idempotent'));

    expect(second.menu.id).toBe(first.menu.id);
    const menuCount = await db.adminClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menus WHERE household_id = $1 AND week_start_date = '2026-09-14'`,
      [householdId],
    );
    expect(Number(menuCount.rows[0]?.count)).toBe(1);
  });
});
