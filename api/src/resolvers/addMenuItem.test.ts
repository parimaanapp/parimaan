import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import * as householdRepository from '../repositories/householdRepository.js';
import {
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  updateSettingsPartial,
} from '../repositories/householdRepository.js';
import { createMenu as createMenuRepo } from '../repositories/menuRepository.js';
import { insertRecipe } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createAddMenuItemHandler } from './addMenuItem.js';
import type { AddMenuItemResolverDeps } from './addMenuItem.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  menuId: unknown,
  input: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ menuId: unknown; input: unknown }> => ({
  arguments: { menuId, input },
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
        } as unknown as AppSyncResolverEvent<{ menuId: unknown; input: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'dayOfWeek', 'mealSlot', 'slotRole'],
    selectionSetGraphQL: '{ id dayOfWeek mealSlot slotRole }',
    parentTypeName: 'Mutation',
    fieldName: 'addMenuItem',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('addMenuItem resolver (Mutation.addMenuItem)', () => {
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

  const baseDeps: AddMenuItemResolverDeps = { getPool: async () => pool };

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
    client: PoolClient,
    householdId: string,
    createdBy: string,
    overrides: { title?: string; role?: string } = {},
  ): Promise<string> => {
    const recipe = await insertRecipe(client, {
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
      role: overrides.role ?? 'sabzi_dal',
      inRotation: true,
      steps: [],
      createdBy,
    });
    return recipe.id;
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-ami-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'AMN234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createAddMenuItemHandler(baseDeps);
    await expect(
      handler(
        buildEvent(
          menuId,
          { recipeId: randomUUID(), dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
          null,
        ),
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid menuId', 'not-a-uuid', { recipeId: randomUUID(), dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' }],
    ['dayOfWeek out of range', undefined, { recipeId: randomUUID(), dayOfWeek: 7, mealSlot: 'lunch', slotRole: 'sabzi_dal' }],
    ['unrecognized mealSlot', undefined, { recipeId: randomUUID(), dayOfWeek: 0, mealSlot: 'brunch', slotRole: 'sabzi_dal' }],
    ['unrecognized slotRole', undefined, { recipeId: randomUUID(), dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'dessert' }],
  ])('rejects invalid input (%s) with ValidationError', async (_label, menuId, input) => {
    const handler = createAddMenuItemHandler(baseDeps);
    await expect(handler(buildEvent(menuId, input, 'sub-ami-validation'))).rejects.toThrow(ValidationError);
  });

  it('gives a nonexistent menuId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-ami-oracle-probe');
    const handler = createAddMenuItemHandler(baseDeps);
    await expect(
      handler(
        buildEvent(
          randomUUID(),
          { recipeId: randomUUID(), dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
          'sub-ami-oracle-probe',
        ),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-ami-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'AMD234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    await createUser('sub-ami-stranger-denial');

    const handler = createAddMenuItemHandler(baseDeps);
    await expect(
      handler(
        buildEvent(
          menuId,
          { recipeId: randomUUID(), dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
          'sub-ami-stranger-denial',
        ),
      ),
    ).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('succeeds within the configured cap and returns the hydrated MenuItem', async () => {
    const owner = await createUser('sub-ami-owner-happy');
    const householdId = await createHouseholdWithOwner(owner, 'AMH234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Rajma', role: 'sabzi_dal' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, 'sub-ami-owner-happy'),
    );

    expect(result.menuId).toBe(menuId);
    expect(result.recipe.id).toBe(recipeId);
    expect(result.dayOfWeek).toBe(1);
    expect(result.mealSlot).toBe('lunch');
    expect(result.slotRole).toBe('sabzi_dal');
  });

  it('accepts an explicit null for servingsOverride, the same as omitting it entirely (§11.5.5 regression class)', async () => {
    const owner = await createUser('sub-ami-owner-nullso');
    const householdId = await createHouseholdWithOwner(owner, 'AMU234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Rajma', role: 'sabzi_dal' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    const result = await handler(
      buildEvent(
        menuId,
        { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'sabzi_dal', servingsOverride: null },
        'sub-ami-owner-nullso',
      ),
    );

    expect(result.servingsOverride).toBeNull();
  });

  it('rejects the next add once a (day, slot, role) triple is at its configured cap', async () => {
    // DEFAULT_MEAL_STRUCTURE caps lunch/sabzi_dal at 2 (domain/householdDefaults.ts).
    const owner = await createUser('sub-ami-owner-cap');
    const householdId = await createHouseholdWithOwner(owner, 'AMC234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const handler = createAddMenuItemHandler(baseDeps);

    const addOne = async (title: string) => {
      const recipeId = await withUserTransaction(
        owner.id,
        (client) => addRecipe(client, householdId, owner.id, { title, role: 'sabzi_dal' }),
        pool,
      );
      return handler(
        buildEvent(menuId, { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, 'sub-ami-owner-cap'),
      );
    };

    await addOne('Rajma');
    await addOne('Chole');

    const thirdRecipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Dal', role: 'sabzi_dal' }),
      pool,
    );
    await expect(
      handler(
        buildEvent(
          menuId,
          { recipeId: thirdRecipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
          'sub-ami-owner-cap',
        ),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("succeeds when the recipe's own role differs from the input slotRole — slotRole is captured independently, not required to match (SD's own MenuItem doc)", async () => {
    const owner = await createUser('sub-ami-owner-roledrift');
    const householdId = await createHouseholdWithOwner(owner, 'AMR234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(
      owner.id,
      // The recipe's own role is 'carb', placed here under slotRole 'sabzi_dal'.
      (client) => addRecipe(client, householdId, owner.id, { title: 'Rice', role: 'carb' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, 'sub-ami-owner-roledrift'),
    );
    expect(result.slotRole).toBe('sabzi_dal');
    expect(result.recipe.role).toBe('carb');
  });

  it('holds the configured cap under concurrent adds to the same slot — the TOCTOU race lockMenuSlot exists to close', async () => {
    // DEFAULT_MEAL_STRUCTURE caps lunch/carb at 1 (domain/householdDefaults.ts)
    // — the tightest cap available, so two simultaneous adds racing for the
    // single remaining slot is the sharpest version of this test.
    const owner = await createUser('sub-ami-owner-race');
    const householdId = await createHouseholdWithOwner(owner, 'AMZ234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const handler = createAddMenuItemHandler(baseDeps);

    const [recipeA, recipeB] = await Promise.all([
      withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'Rice', role: 'carb' }), pool),
      withUserTransaction(owner.id, (client) => addRecipe(client, householdId, owner.id, { title: 'Roti', role: 'carb' }), pool),
    ]);

    const results = await Promise.allSettled([
      handler(buildEvent(menuId, { recipeId: recipeA, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'carb' }, 'sub-ami-owner-race')),
      handler(buildEvent(menuId, { recipeId: recipeB, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'carb' }, 'sub-ami-owner-race')),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    }

    const countResult = await db.adminClient.query(
      `SELECT COUNT(*)::text AS count FROM menu_items WHERE menu_id = $1 AND day_of_week = 1 AND meal_slot = 'lunch' AND slot_role = 'carb'`,
      [menuId],
    );
    expect(countResult.rows[0]?.count).toBe('1');
  });

  it('rejects entirely when mealSlot is not in the household\'s mealsEnabled (snacks disabled by default)', async () => {
    const owner = await createUser('sub-ami-owner-disabled');
    const householdId = await createHouseholdWithOwner(owner, 'AMS234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Poha', role: 'snack' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    await expect(
      handler(
        buildEvent(menuId, { recipeId, dayOfWeek: 0, mealSlot: 'snacks', slotRole: 'snack' }, 'sub-ami-owner-disabled'),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('breakfast (a single-item slot) accepts exactly one item and rejects a second, regardless of role', async () => {
    const owner = await createUser('sub-ami-owner-breakfast');
    const householdId = await createHouseholdWithOwner(owner, 'AMB234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
    const handler = createAddMenuItemHandler(baseDeps);

    const firstRecipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Poha', role: 'breakfast' }),
      pool,
    );
    await handler(
      buildEvent(
        menuId,
        { recipeId: firstRecipeId, dayOfWeek: 0, mealSlot: 'breakfast', slotRole: 'breakfast' },
        'sub-ami-owner-breakfast',
      ),
    );

    const secondRecipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Upma', role: 'breakfast' }),
      pool,
    );
    await expect(
      handler(
        buildEvent(
          menuId,
          { recipeId: secondRecipeId, dayOfWeek: 0, mealSlot: 'breakfast', slotRole: 'breakfast' },
          'sub-ami-owner-breakfast',
        ),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a recipeId belonging to a DIFFERENT household, even one the caller also belongs to", async () => {
    const owner = await createUser('sub-ami-owner-cross');
    const householdId = await createHouseholdWithOwner(owner, 'AMX234');
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const otherHouseholdId = await createHouseholdWithOwner(owner, 'AMY234');
    const foreignRecipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, otherHouseholdId, owner.id, { title: 'Foreign Rajma', role: 'sabzi_dal' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    await expect(
      handler(
        buildEvent(
          menuId,
          { recipeId: foreignRecipeId, dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
          'sub-ami-owner-cross',
        ),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('accepts an add once mealsEnabled is updated to include the slot, for a menu created AFTER that update', async () => {
    // W14 S3 (E2E_MVP_PLAN.md §20.2.3 D3): `addMenuItem` enforces
    // `mealsEnabled` from the MENU's own frozen `meal_config_snapshot`, not
    // live `household_settings` — so the settings update must happen
    // BEFORE `createMenuFor` for this menu to pick it up. (Pre-W14-S3 this
    // test updated settings AFTER menu creation and still expected the add
    // to succeed, because addMenuItem read live settings at add-time; that
    // is precisely the behaviour D1/D3 deliberately remove — see the new
    // "a menu created BEFORE a mealsEnabled update stays on the OLD
    // snapshot" test directly below for the regression coverage of the case
    // this test used to (incorrectly, per the new contract) exercise.)
    const owner = await createUser('sub-ami-owner-enable');
    const householdId = await createHouseholdWithOwner(owner, 'AME234');

    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealsEnabled: ['breakfast', 'lunch', 'snacks', 'dinner'] }),
      pool,
    );

    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Poha', role: 'snack' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    const result = await handler(
      buildEvent(menuId, { recipeId, dayOfWeek: 0, mealSlot: 'snacks', slotRole: 'snack' }, 'sub-ami-owner-enable'),
    );
    expect(result.mealSlot).toBe('snacks');
  });

  it('a menu created BEFORE a mealsEnabled update stays on the OLD snapshot — the update does not retroactively unlock the slot (W14 S3 headline guarantee)', async () => {
    const owner = await createUser('sub-ami-owner-frozen-enable');
    const householdId = await createHouseholdWithOwner(owner, 'AMZ734');
    // Menu created FIRST, while snacks is still disabled (DEFAULT_MEALS_ENABLED).
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    // Settings updated AFTER the menu already exists — must NOT retroactively affect it.
    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealsEnabled: ['breakfast', 'lunch', 'snacks', 'dinner'] }),
      pool,
    );

    const recipeId = await withUserTransaction(
      owner.id,
      (client) => addRecipe(client, householdId, owner.id, { title: 'Poha', role: 'snack' }),
      pool,
    );

    const handler = createAddMenuItemHandler(baseDeps);
    await expect(
      handler(
        buildEvent(menuId, { recipeId, dayOfWeek: 0, mealSlot: 'snacks', slotRole: 'snack' }, 'sub-ami-owner-frozen-enable'),
      ),
    ).rejects.toThrow(ConflictError);
  });

  // ---------------------------------------------------------------------
  // W14 S3 (E2E_MVP_PLAN.md §20.3) — server read path switches to the
  // menu's own `meal_config_snapshot`. These are the slice's own RED tests,
  // items 1/2/6 of the S3 RED list (item 3, the Dinner-disable case, mirrors
  // items 1/2 exactly against `mealsEnabled` rather than `mealStructure`
  // and is covered by the two tests immediately above this block).
  // ---------------------------------------------------------------------

  it('W14 S3: lowering mealStructure.lunch.carb from 2 to 1 mid-week still allows a SECOND carb in the already-created week, and rejects a third', async () => {
    const owner = await createUser('sub-ami-w14-lowercap');
    const householdId = await createHouseholdWithOwner(owner, 'AMW134');
    // Widen lunch/carb to 2 BEFORE the menu is created, so the menu's
    // snapshot freezes at cap 2.
    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealStructure: { lunch: { carb: 2 } } }),
      pool,
    );
    const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    const handler = createAddMenuItemHandler(baseDeps);
    const addOne = async (title: string) => {
      const recipeId = await withUserTransaction(
        owner.id,
        (client) => addRecipe(client, householdId, owner.id, { title, role: 'carb' }),
        pool,
      );
      return handler(
        buildEvent(menuId, { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'carb' }, 'sub-ami-w14-lowercap'),
      );
    };

    // First carb placed while the snapshot still says cap 2.
    await addOne('Rice');

    // Now lower the LIVE cap back to 1 — must NOT affect this already-created menu.
    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealStructure: { lunch: { carb: 1 } } }),
      pool,
    );

    // A second carb still fits — the menu's own snapshot still says cap 2.
    await expect(addOne('Roti')).resolves.toBeDefined();

    // A third does not — the snapshot's cap of 2 is now reached.
    await expect(addOne('Paratha')).rejects.toThrow(ConflictError);
  });

  it('W14 S3: the FOLLOWING week\'s menu (created after the cap edit) caps at the NEW value — the other half of the snapshot guarantee', async () => {
    const owner = await createUser('sub-ami-w14-nextweek');
    const householdId = await createHouseholdWithOwner(owner, 'AMW234');
    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealStructure: { lunch: { carb: 2 } } }),
      pool,
    );
    // This week's menu freezes at cap 2.
    await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');

    // Lower the cap, THEN create next week's menu — it should freeze at the NEW value, 1.
    await withUserTransaction(
      owner.id,
      (client) => updateSettingsPartial(client, householdId, { mealStructure: { lunch: { carb: 1 } } }),
      pool,
    );
    const nextWeekMenuId = await createMenuFor(owner, householdId, '2026-09-14T00:00:00.000Z');

    const handler = createAddMenuItemHandler(baseDeps);
    const addOne = async (title: string) => {
      const recipeId = await withUserTransaction(
        owner.id,
        (client) => addRecipe(client, householdId, owner.id, { title, role: 'carb' }),
        pool,
      );
      return handler(
        buildEvent(nextWeekMenuId, { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'carb' }, 'sub-ami-w14-nextweek'),
      );
    };

    await addOne('Rice');
    // A second carb must be rejected — the NEXT week's own snapshot caps carb at 1.
    await expect(addOne('Roti')).rejects.toThrow(ConflictError);
  });

  it('W14 S3: addMenuItem never calls findSettingsForHousehold — mealsEnabled/mealStructure come only from the menu\'s own snapshot', async () => {
    const spy = vi.spyOn(householdRepository, 'findSettingsForHousehold');
    try {
      const owner = await createUser('sub-ami-w14-spy');
      const householdId = await createHouseholdWithOwner(owner, 'AMW334');
      const menuId = await createMenuFor(owner, householdId, '2026-09-07T00:00:00.000Z');
      const recipeId = await withUserTransaction(
        owner.id,
        (client) => addRecipe(client, householdId, owner.id, { title: 'Rajma', role: 'sabzi_dal' }),
        pool,
      );

      // `createHouseholdWithOwner`/`createMenuFor` above call
      // `insertDefaultSettings`/`createMenu` directly (not through this
      // spy's import path in a way that matters here) — reset the count
      // right before invoking the resolver under test so this assertion is
      // scoped to addMenuItem's OWN call path, not setup.
      spy.mockClear();

      const handler = createAddMenuItemHandler(baseDeps);
      await handler(
        buildEvent(menuId, { recipeId, dayOfWeek: 1, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, 'sub-ami-w14-spy'),
      );

      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
