import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from './userRepository.js';
import { insertHousehold, insertMembership } from './householdRepository.js';
import {
  deleteRecipeById,
  deleteRecipeIngredientsByRecipeId,
  findRecipeIngredientsByRecipeId,
  findRecipes,
  insertRecipe as insertRecipeRow,
  insertRecipeIngredient as insertRecipeIngredientRow,
  updateRecipePartial,
} from './recipeRepository.js';
import type { UserRow } from './userRepository.js';

describe('recipeRepository', () => {
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

  const asUser = <T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> =>
    withUserTransaction(userId, fn, pool);

  const createUser = async (): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, {
        cognitoSub: `sub-${randomUUID()}`,
        email: `${randomUUID()}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const createHouseholdWithMember = async (owner: UserRow): Promise<string> =>
    asUser(owner.id, async (client) => {
      const household = await insertHousehold(client, {
        name: `House ${randomUUID()}`,
        inviteCode: `INV${randomUUID().slice(0, 6)}`,
        primaryUserId: owner.id,
      });
      await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
      return household.id;
    });

  const insertRecipe = async (
    client: PoolClient,
    householdId: string,
    createdBy: string,
    overrides: { title?: string; role?: string; isFavorite?: boolean } = {},
  ): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, is_favorite, created_by)
       VALUES ($1, 'user', $2, $3, $4, $5) RETURNING id`,
      [
        householdId,
        overrides.title ?? 'Rajma',
        overrides.role ?? 'sabzi_dal',
        overrides.isFavorite ?? false,
        createdBy,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Expected an inserted recipe row.');
    }
    return row;
  };

  it('returns [] for a household with no recipes', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    const rows = await asUser(owner.id, (client) => findRecipes(client, householdId));
    expect(rows).toEqual([]);
  });

  it('finds recipes ordered favorite-first, then by title', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    await asUser(owner.id, async (client) => {
      await insertRecipe(client, householdId, owner.id, { title: 'Zucchini Sabzi' });
      await insertRecipe(client, householdId, owner.id, { title: 'Aloo Gobi', isFavorite: true });
      await insertRecipe(client, householdId, owner.id, { title: 'Baingan Bharta' });
    });

    const rows = await asUser(owner.id, (client) => findRecipes(client, householdId));
    expect(rows.map((r) => r.title)).toEqual(['Aloo Gobi', 'Baingan Bharta', 'Zucchini Sabzi']);
  });

  it('filters by role', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    await asUser(owner.id, async (client) => {
      await insertRecipe(client, householdId, owner.id, { title: 'Rajma', role: 'sabzi_dal' });
      await insertRecipe(client, householdId, owner.id, { title: 'Poha', role: 'breakfast' });
    });

    const rows = await asUser(owner.id, (client) =>
      findRecipes(client, householdId, { role: 'breakfast' }),
    );
    expect(rows.map((r) => r.title)).toEqual(['Poha']);
  });

  it('filters by isFavorite', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    await asUser(owner.id, async (client) => {
      await insertRecipe(client, householdId, owner.id, { title: 'Rajma', isFavorite: true });
      await insertRecipe(client, householdId, owner.id, { title: 'Chole', isFavorite: false });
    });

    const rows = await asUser(owner.id, (client) =>
      findRecipes(client, householdId, { isFavorite: true }),
    );
    expect(rows.map((r) => r.title)).toEqual(['Rajma']);
  });

  it('maps every recipes column, including numeric-typed fields as numbers', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    await asUser(owner.id, (client) =>
      client.query(
        `INSERT INTO recipes (household_id, source_type, title, description, servings, prep_min, cook_min, cuisine_tier1, dietary_tags, role, steps, created_by)
         VALUES ($1, 'user', 'Rajma Chawal', 'Weeknight staple', 4, 10, 30, 'north_indian', '["veg"]', 'sabzi_dal', '["Soak rajma overnight", "Pressure cook"]', $2)`,
        [householdId, owner.id],
      ),
    );

    const rows = await asUser(owner.id, (client) => findRecipes(client, householdId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Rajma Chawal',
      description: 'Weeknight staple',
      servings: 4,
      prepMin: 10,
      cookMin: 30,
      cuisineTier1: 'north_indian',
      dietaryTags: ['veg'],
      role: 'sabzi_dal',
      steps: ['Soak rajma overnight', 'Pressure cook'],
      inRotation: true,
      isFavorite: false,
      sourceType: 'user',
    });
  });

  it("does not leak another household's recipes into an unfiltered read (RLS)", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const householdA = await createHouseholdWithMember(ownerA);
    const householdB = await createHouseholdWithMember(ownerB);
    await asUser(ownerA.id, (client) => insertRecipe(client, householdA, ownerA.id));
    await asUser(ownerB.id, (client) => insertRecipe(client, householdB, ownerB.id));

    const rowsForA = await asUser(ownerA.id, (client) => findRecipes(client, householdA));
    expect(rowsForA).toHaveLength(1);
  });

  describe('findRecipeIngredientsByRecipeId', () => {
    it('returns ingredients ordered by sort_order', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const recipeId = await asUser(owner.id, async (client) => {
        const recipe = await insertRecipe(client, householdId, owner.id);
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, name, sort_order) VALUES ($1, 'Onion', 1), ($1, 'Rajma beans', 0)`,
          [recipe.id],
        );
        return recipe.id;
      });

      const rows = await asUser(owner.id, (client) =>
        findRecipeIngredientsByRecipeId(client, recipeId),
      );
      expect(rows.map((r) => r.name)).toEqual(['Rajma beans', 'Onion']);
    });

    it('returns [] for a recipe with no ingredients', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipeId = await asUser(owner.id, (client) =>
        insertRecipe(client, householdId, owner.id),
      ).then((r) => r.id);

      const rows = await asUser(owner.id, (client) =>
        findRecipeIngredientsByRecipeId(client, recipeId),
      );
      expect(rows).toEqual([]);
    });

    it('parses numeric quantity as a number, not a string', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const recipeId = await asUser(owner.id, async (client) => {
        const recipe = await insertRecipe(client, householdId, owner.id);
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit) VALUES ($1, 'Rajma beans', 2.5, 'cup')`,
          [recipe.id],
        );
        return recipe.id;
      });

      const rows = await asUser(owner.id, (client) =>
        findRecipeIngredientsByRecipeId(client, recipeId),
      );
      expect(rows[0]?.quantity).toBe(2.5);
      expect(typeof rows[0]?.quantity).toBe('number');
    });

    // The single most important test in this repository (E2E_MVP_PLAN.md
    // §12.2.2/§12.5.2): this function takes no `householdId` — RLS alone
    // gates it. A non-member's call for a real recipe in another household
    // must return `[]`, indistinguishable from a recipe with no
    // ingredients, never leak another household's ingredient list.
    it("does not leak another household's recipe_ingredients (RLS, no householdId to gate on)", async () => {
      const ownerA = await createUser();
      const ownerB = await createUser();
      const householdA = await createHouseholdWithMember(ownerA);
      await createHouseholdWithMember(ownerB);

      const recipeId = await asUser(ownerA.id, async (client) => {
        const recipe = await insertRecipe(client, householdA, ownerA.id);
        await client.query(`INSERT INTO recipe_ingredients (recipe_id, name) VALUES ($1, 'Rajma beans')`, [
          recipe.id,
        ]);
        return recipe.id;
      });

      const rowsAsOutsider = await asUser(ownerB.id, (client) =>
        findRecipeIngredientsByRecipeId(client, recipeId),
      );
      expect(rowsAsOutsider).toEqual([]);

      // Sanity check that the fixture itself is real — the owner still sees it.
      const rowsAsOwner = await asUser(ownerA.id, (client) =>
        findRecipeIngredientsByRecipeId(client, recipeId),
      );
      expect(rowsAsOwner).toHaveLength(1);
    });
  });

  describe('insertRecipe', () => {
    it('inserts a recipe with every column populated and returns it mapped', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const row = await asUser(owner.id, (client) =>
        insertRecipeRow(client, {
          householdId,
          sourceType: 'user',
          title: 'Rajma Chawal',
          description: 'Weeknight staple',
          servings: 4,
          prepMin: 10,
          cookMin: 30,
          cuisineTier1: 'north_indian',
          cuisineTier2: 'punjabi',
          dietaryTags: ['veg'],
          role: 'sabzi_dal',
          inRotation: true,
          steps: ['Soak', 'Cook'],
          createdBy: owner.id,
        }),
      );

      expect(row).toMatchObject({
        householdId,
        sourceType: 'user',
        title: 'Rajma Chawal',
        description: 'Weeknight staple',
        servings: 4,
        prepMin: 10,
        cookMin: 30,
        cuisineTier1: 'north_indian',
        cuisineTier2: 'punjabi',
        dietaryTags: ['veg'],
        role: 'sabzi_dal',
        inRotation: true,
        isFavorite: false,
        steps: ['Soak', 'Cook'],
        createdBy: owner.id,
      });
    });

    it('inserts a recipe with all nullable fields null and empty steps', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const row = await asUser(owner.id, (client) =>
        insertRecipeRow(client, {
          householdId,
          sourceType: 'user',
          title: 'Quick Poha',
          description: null,
          servings: 2,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: 'breakfast',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        }),
      );

      expect(row.description).toBeNull();
      expect(row.prepMin).toBeNull();
      expect(row.cookMin).toBeNull();
      expect(row.cuisineTier1).toBeNull();
      expect(row.steps).toEqual([]);
    });
  });

  describe('insertRecipeIngredient', () => {
    it('inserts an ingredient with every column populated and returns it mapped', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipeId = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id)).then(
        (r) => r.id,
      );

      const row = await asUser(owner.id, (client) =>
        insertRecipeIngredientRow(client, {
          recipeId,
          name: 'Rajma beans',
          quantity: 2,
          unit: 'cup',
          category: 'dal',
          notes: 'soaked overnight',
          isStaple: false,
          sortOrder: 0,
        }),
      );

      expect(row).toMatchObject({
        recipeId,
        name: 'Rajma beans',
        quantity: 2,
        unit: 'cup',
        category: 'dal',
        notes: 'soaked overnight',
        isStaple: false,
        sortOrder: 0,
      });
    });

    it('inserts an ingredient with nullable fields null', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipeId = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id)).then(
        (r) => r.id,
      );

      const row = await asUser(owner.id, (client) =>
        insertRecipeIngredientRow(client, {
          recipeId,
          name: 'Salt',
          quantity: null,
          unit: null,
          category: null,
          notes: null,
          isStaple: true,
          sortOrder: 3,
        }),
      );

      expect(row.quantity).toBeNull();
      expect(row.unit).toBeNull();
      expect(row.isStaple).toBe(true);
      expect(row.sortOrder).toBe(3);
    });
  });

  describe('updateRecipePartial', () => {
    it('patches only the given fields, leaving the rest unchanged', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) =>
        insertRecipeRow(client, {
          householdId,
          sourceType: 'user',
          title: 'Original',
          description: 'Original description',
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
      );

      const row = await asUser(owner.id, (client) =>
        updateRecipePartial(client, recipe.id, { servings: 8 }),
      );

      expect(row?.servings).toBe(8);
      expect(row?.title).toBe('Original');
      expect(row?.description).toBe('Original description');
    });

    it('returns null when no row matches the id', async () => {
      const owner = await createUser();
      await createHouseholdWithMember(owner);

      const row = await asUser(owner.id, (client) =>
        updateRecipePartial(client, randomUUID(), { title: 'X' }),
      );
      expect(row).toBeNull();
    });

    it('bumps updated_at even for a patch with a single field', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) =>
        insertRecipeRow(client, {
          householdId,
          sourceType: 'user',
          title: 'Original',
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
      );

      const row = await asUser(owner.id, (client) =>
        updateRecipePartial(client, recipe.id, { title: 'Renamed' }),
      );
      // Both timestamps come from the same DB server clock, so this is
      // immune to any client/container clock skew a `Date.now()` snapshot
      // would be exposed to.
      expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(recipe.updatedAt.getTime());
    });
  });

  describe('deleteRecipeIngredientsByRecipeId', () => {
    it('removes every ingredient for the recipe', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id));
      await asUser(owner.id, (client) =>
        insertRecipeIngredientRow(client, {
          recipeId: recipe.id,
          name: 'Onion',
          quantity: null,
          unit: null,
          category: null,
          notes: null,
          isStaple: false,
          sortOrder: 0,
        }),
      );

      await asUser(owner.id, (client) => deleteRecipeIngredientsByRecipeId(client, recipe.id));

      const rows = await asUser(owner.id, (client) =>
        findRecipeIngredientsByRecipeId(client, recipe.id),
      );
      expect(rows).toEqual([]);
    });
  });

  describe('deleteRecipeById', () => {
    it('deletes the recipe and returns the deleted row', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id));

      const row = await asUser(owner.id, (client) => deleteRecipeById(client, recipe.id));
      expect(row?.id).toBe(recipe.id);

      const remaining = await asUser(owner.id, (client) => findRecipes(client, householdId));
      expect(remaining).toEqual([]);
    });

    it('returns null when no row matches the id', async () => {
      const owner = await createUser();
      await createHouseholdWithMember(owner);

      const row = await asUser(owner.id, (client) => deleteRecipeById(client, randomUUID()));
      expect(row).toBeNull();
    });
  });
});
