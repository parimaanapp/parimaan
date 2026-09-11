import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { findMembershipsForUser, insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createCreateHouseholdHandler } from './createHousehold.js';
import { UnauthorizedError, ValidationError } from '../errors.js';
import type { RandomIntFn } from '../domain/inviteCode.js';
import type { CuratedRecipeInput } from '../curatedRecipes.js';

/**
 * Small fixture set (2-3 recipes) for the W16 S4 curated-seeder RED tests
 * — NOT the real 50-file corpus (that's S5's job, per E2E_MVP_PLAN.md
 * §22.3 S4's own "the RED tests below use fixtures" note). Two recipes is
 * enough to prove ingredients aren't cross-linked between recipes (RED
 * test 4).
 */
const FIXTURE_RECIPES: CuratedRecipeInput[] = [
  {
    title: 'Fixture Dal Tadka',
    description: 'A simple fixture recipe for seeder tests.',
    servings: 4,
    prepMin: 10,
    cookMin: 20,
    cuisineTier1: 'north_indian',
    cuisineTier2: null,
    dietaryTags: ['veg'],
    role: 'sabzi_dal',
    inRotation: true,
    ingredients: [
      { name: 'Toor dal', quantity: 1, unit: 'cup', category: 'pantry', notes: null, isStaple: true },
      { name: 'Turmeric', quantity: 1, unit: 'tsp', category: 'spice', notes: null, isStaple: true },
    ],
    steps: ['Boil the dal.', 'Add turmeric and simmer.'],
  },
  {
    title: 'Fixture Jeera Rice',
    description: 'Another simple fixture recipe.',
    servings: 4,
    prepMin: 5,
    cookMin: 15,
    cuisineTier1: 'north_indian',
    cuisineTier2: null,
    dietaryTags: ['veg', 'vegan'],
    role: 'carb',
    inRotation: true,
    ingredients: [
      { name: 'Basmati rice', quantity: 2, unit: 'cup', category: 'pantry', notes: null, isStaple: true },
      { name: 'Cumin seeds', quantity: 1, unit: 'tsp', category: 'spice', notes: null, isStaple: true },
      { name: 'Ghee', quantity: 1, unit: 'tbsp', category: 'dairy', notes: null, isStaple: true },
    ],
    steps: ['Wash the rice.', 'Temper cumin in ghee.', 'Cook rice with the tempering.'],
  },
];

const buildEvent = (
  name: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ name: unknown }> => ({
  arguments: { name },
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
        } as unknown as AppSyncResolverEvent<{ name: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'createHousehold',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('createHousehold resolver', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const countRows = async (table: string): Promise<number> => {
    const result = await db.adminClient.query(`SELECT 1 FROM ${table}`);
    return result.rows.length;
  };

  it('rejects a null identity with UnauthorizedError, writing zero rows', async () => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('Test House', null))).rejects.toThrow(UnauthorizedError);
    expect(await countRows('households')).toBe(0);
  });

  it.each([
    ['empty string', ''],
    ['whitespace-only', '   '],
    ['over 60 chars', 'a'.repeat(61)],
    ['absent', undefined],
    ['numeric', 12345],
    ['control character', 'Bad\tName'],
  ])('rejects a %s name with ValidationError, writing zero rows', async (_label, name) => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(name, 'sub-validation'))).rejects.toThrow(ValidationError);
    expect(await countRows('households')).toBe(0);
  });

  it('happy path: creates a household, primary membership, and default settings matching the domain defaults', async () => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    const result = await handler(buildEvent('The Sharma House', 'sub-happy'));

    expect(result.name).toBe('The Sharma House');
    expect(result.inviteCode).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(result.subscriptionStatus).toBe('free');
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({ role: 'primary' });
    expect(result.settings.mealsEnabled).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(result.settings.mealStructure).toEqual({
      lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
      dinner: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
    });

    expect(await countRows('households')).toBe(1);
    expect(await countRows('household_memberships')).toBe(1);
    expect(await countRows('household_settings')).toBe(1);

    const client = await pool.connect();
    try {
      const householdRow = await client.query('SELECT primary_user_id FROM households WHERE id = $1', [
        result.id,
      ]);
      const userRow = await client.query('SELECT id FROM users WHERE cognito_sub = $1', ['sub-happy']);
      expect(householdRow.rows[0].primary_user_id).toBe(userRow.rows[0].id);
    } finally {
      client.release();
    }
  });

  it("derives primaryUserId from identity.sub, never influenceable via arguments", async () => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    const event = buildEvent('No Injection House', 'sub-noinject');
    // There is no primaryUserId/userId argument on this mutation at all —
    // assert the arguments object truly has no such field, and that the
    // resulting household's primary_user_id matches the caller derived from
    // identity, not anything in `arguments`.
    expect(Object.keys(event.arguments)).toEqual(['name']);

    const result = await handler(event);
    const client = await pool.connect();
    try {
      const userRow = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [
        'sub-noinject',
      ]);
      expect(result.primaryUserId).toBe(userRow.rows[0].id);
    } finally {
      client.release();
    }
  });

  it('retries invite code generation on a collision, succeeding on the second attempt', async () => {
    // Pre-seed a household with a known invite code.
    const client = await pool.connect();
    let seededOwnerId: string;
    try {
      const owner = await upsertUserByCognitoSub(client, {
        cognitoSub: 'sub-seed',
        email: 'seed@example.test',
        displayName: null,
        avatarUrl: null,
      });
      seededOwnerId = owner.id;
    } finally {
      client.release();
    }
    await withUserTransaction(
      seededOwnerId,
      async (txClient) => {
        const seeded = await insertHousehold(txClient, {
          name: 'Seed House',
          inviteCode: 'AAA234',
          primaryUserId: seededOwnerId,
        });
        await insertMembership(txClient, {
          householdId: seeded.id,
          userId: seededOwnerId,
          role: 'primary',
        });
        await insertDefaultSettings(txClient, seeded.id);
      },
      pool,
    );

    const collidingThenFresh: RandomIntFn = (() => {
      let call = 0;
      // First 6 randomInt calls spell out 'AAA234' (the seeded code);
      // the next 6 spell out 'BBB234' (a fresh code).
      const codes = ['AAA234', 'BBB234'];
      const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
      return (_min: number, _max: number): number => {
        const codeIndex = Math.floor(call / 6);
        const charIndex = call % 6;
        call += 1;
        const code = codes[codeIndex];
        if (code === undefined) {
          throw new Error('ran out of stubbed invite codes');
        }
        const char = code[charIndex];
        if (char === undefined) {
          throw new Error('invite code stub out of range');
        }
        return alphabet.indexOf(char);
      };
    })();

    const handler = createCreateHouseholdHandler({
      getPool: async () => pool,
      randomInt: collidingThenFresh,
    });
    const result = await handler(buildEvent('Retry House', 'sub-retry'));
    expect(result.inviteCode).toBe('BBB234');
    expect(await countRows('households')).toBe(2);
  });

  it('exhausts invite code retries (5 attempts) and throws, writing zero new rows', async () => {
    const alwaysCollide: RandomIntFn = () => 0; // '2' repeated, alphabet[0] === '2'
    const client = await pool.connect();
    let seededOwnerId: string;
    try {
      const owner = await upsertUserByCognitoSub(client, {
        cognitoSub: 'sub-exhaust-seed',
        email: 'exhaust-seed@example.test',
        displayName: null,
        avatarUrl: null,
      });
      seededOwnerId = owner.id;
    } finally {
      client.release();
    }
    await withUserTransaction(
      seededOwnerId,
      async (txClient) => {
        const seeded = await insertHousehold(txClient, {
          name: 'Collision House',
          inviteCode: '222222',
          primaryUserId: seededOwnerId,
        });
        await insertMembership(txClient, {
          householdId: seeded.id,
          userId: seededOwnerId,
          role: 'primary',
        });
        await insertDefaultSettings(txClient, seeded.id);
      },
      pool,
    );

    const handler = createCreateHouseholdHandler({
      getPool: async () => pool,
      randomInt: alwaysCollide,
    });
    await expect(handler(buildEvent('Exhausted House', 'sub-exhaust'))).rejects.toThrow();
    expect(await countRows('households')).toBe(1); // only the pre-seeded one
  });

  it('rolls back the transaction if the settings insert fails, leaving no household or membership rows', async () => {
    const handler = createCreateHouseholdHandler({
      getPool: async () => pool,
      insertDefaultSettings: async () => {
        throw new Error('Forced settings-insert failure for this test.');
      },
    });

    await expect(handler(buildEvent('Rollback House', 'sub-rollback'))).rejects.toThrow();
    expect(await countRows('households')).toBe(0);
    expect(await countRows('household_memberships')).toBe(0);
  });

  it("cross-tenant: user B's memberships never include user A's household", async () => {
    const handlerA = createCreateHouseholdHandler({ getPool: async () => pool });
    await handlerA(buildEvent('House A', 'sub-cross-a'));

    const clientB = await pool.connect();
    let userB;
    try {
      userB = await upsertUserByCognitoSub(clientB, {
        cognitoSub: 'sub-cross-b',
        email: 'sub-cross-b@example.test',
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      clientB.release();
    }

    const membershipsB = await withUserTransaction(
      userB.id,
      (client) => findMembershipsForUser(client, userB.id),
      pool,
    );
    expect(membershipsB).toEqual([]);
  });

  // W16 §22.3 S4 — curated-seeder Lambda step inside `createHousehold`'s
  // existing transaction. Every test above this point must keep passing
  // UNMODIFIED (see the top-level file comment's "zero assertion edits"
  // discipline) — these new tests exercise ONLY the new fifth step.
  describe('curated-recipe seeding (W16 S4)', () => {
    const findRecipesForHousehold = async (householdId: string) => {
      const result = await db.adminClient.query(
        `SELECT * FROM recipes WHERE household_id = $1 ORDER BY title`,
        [householdId],
      );
      return result.rows;
    };

    const findIngredientsForRecipe = async (recipeId: string) => {
      const result = await db.adminClient.query(
        `SELECT * FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
        [recipeId],
      );
      return result.rows;
    };

    it('seeds every fixture recipe onto the newly created household', async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => FIXTURE_RECIPES,
      });
      const result = await handler(buildEvent('Seeded House', 'sub-seed-1'));

      const recipes = await findRecipesForHousehold(result.id);
      expect(recipes).toHaveLength(FIXTURE_RECIPES.length);
      expect(recipes.map((r) => r.title).sort()).toEqual(
        FIXTURE_RECIPES.map((r) => r.title).sort(),
      );
      for (const recipe of recipes) {
        expect(recipe.household_id).toBe(result.id);
      }
    });

    it("sets every seeded recipe's created_by to the calling user's own id", async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => FIXTURE_RECIPES,
      });
      const result = await handler(buildEvent('Seeded House 2', 'sub-seed-2'));

      const userRow = await db.adminClient.query('SELECT id FROM users WHERE cognito_sub = $1', [
        'sub-seed-2',
      ]);
      const callerUserId = userRow.rows[0].id;
      expect(callerUserId).toBeTruthy();

      const recipes = await findRecipesForHousehold(result.id);
      expect(recipes.length).toBeGreaterThan(0);
      for (const recipe of recipes) {
        expect(recipe.created_by).toBe(callerUserId);
        expect(recipe.created_by).not.toBeNull();
      }
    });

    it("sets every seeded recipe's sourceType to exactly 'curated'", async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => FIXTURE_RECIPES,
      });
      const result = await handler(buildEvent('Seeded House 3', 'sub-seed-3'));

      const recipes = await findRecipesForHousehold(result.id);
      expect(recipes.length).toBeGreaterThan(0);
      for (const recipe of recipes) {
        expect(recipe.source_type).toBe('curated');
        expect(recipe.source_url).toBeNull();
      }
    });

    it('inserts ingredients correctly linked to the right recipe, never cross-linked', async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => FIXTURE_RECIPES,
      });
      const result = await handler(buildEvent('Seeded House 4', 'sub-seed-4'));

      const recipes = await findRecipesForHousehold(result.id);
      expect(recipes).toHaveLength(FIXTURE_RECIPES.length);

      for (const fixture of FIXTURE_RECIPES) {
        const dbRecipe = recipes.find((r) => r.title === fixture.title);
        expect(dbRecipe).toBeDefined();
        const ingredients = await findIngredientsForRecipe(dbRecipe.id);
        expect(ingredients).toHaveLength(fixture.ingredients.length);
        expect(ingredients.map((i) => i.name)).toEqual(fixture.ingredients.map((i) => i.name));
        for (const ingredient of ingredients) {
          expect(ingredient.recipe_id).toBe(dbRecipe.id);
        }
      }
    });

    it('rolls back the ENTIRE transaction when seeding fails mid-way (fixture-list throws)', async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => {
          throw new Error('Forced curated-recipe-list failure for this test.');
        },
      });

      await expect(handler(buildEvent('Failed Seed House', 'sub-seed-fail-1'))).rejects.toThrow();
      expect(await countRows('households')).toBe(0);
      expect(await countRows('household_memberships')).toBe(0);
      expect(await countRows('household_settings')).toBe(0);
      expect(await countRows('recipes')).toBe(0);
      expect(await countRows('recipe_ingredients')).toBe(0);
    });

    it('rolls back the ENTIRE transaction when one fixture recipe fails to insert mid-batch', async () => {
      // Force the failure through a fixture list whose second entry has a
      // `role` the DB's own CHECK constraint rejects — the seeder path
      // calls `insertRecipe` directly (unvalidated by `createRecipe`'s own
      // Zod schema, same as how a real curated JSON file is trusted
      // content, not client input), so the failure surfaces at INSERT
      // time, after the first fixture recipe has already been inserted in
      // this same transaction — the direct proof of D2's "never partially
      // seeded" guarantee.
      const recipesWithBadSecondEntry: CuratedRecipeInput[] = [
        FIXTURE_RECIPES[0]!,
        {
          ...FIXTURE_RECIPES[1]!,
          role: 'not_a_real_role' as CuratedRecipeInput['role'],
        },
      ];

      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => recipesWithBadSecondEntry,
      });

      await expect(handler(buildEvent('Failed Seed House 2', 'sub-seed-fail-2'))).rejects.toThrow();
      expect(await countRows('households')).toBe(0);
      expect(await countRows('household_memberships')).toBe(0);
      expect(await countRows('household_settings')).toBe(0);
      expect(await countRows('recipes')).toBe(0);
      expect(await countRows('recipe_ingredients')).toBe(0);
    });

    it('seeds a SECOND, INDEPENDENT copy of the fixture recipes for a second household by the same user', async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => FIXTURE_RECIPES,
      });

      const resultA = await handler(buildEvent('First House', 'sub-seed-twice'));
      const resultB = await handler(buildEvent('Second House', 'sub-seed-twice'));

      expect(resultA.id).not.toBe(resultB.id);

      const recipesA = await findRecipesForHousehold(resultA.id);
      const recipesB = await findRecipesForHousehold(resultB.id);

      expect(recipesA).toHaveLength(FIXTURE_RECIPES.length);
      expect(recipesB).toHaveLength(FIXTURE_RECIPES.length);

      const idsA = new Set(recipesA.map((r) => r.id));
      const idsB = new Set(recipesB.map((r) => r.id));
      for (const id of idsB) {
        expect(idsA.has(id)).toBe(false);
      }

      expect(recipesA.map((r) => r.title).sort()).toEqual(recipesB.map((r) => r.title).sort());
    });

    it('leaves non-member/unauthenticated denial on createHousehold unchanged (regression check)', async () => {
      const handler = createCreateHouseholdHandler({
        getPool: async () => pool,
        getCuratedRecipes: () => FIXTURE_RECIPES,
      });
      await expect(handler(buildEvent('Denied House', null))).rejects.toThrow(UnauthorizedError);
      expect(await countRows('households')).toBe(0);
      expect(await countRows('recipes')).toBe(0);
    });
  });
});
