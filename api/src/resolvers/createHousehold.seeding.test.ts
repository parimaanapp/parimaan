import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { syncCatalog } from '../catalog/syncCatalog.js';
import { catalogBundle } from '../catalog/bundle.js';
import { resetCatalogCacheForTesting } from '../repositories/catalogRepository.js';
import { getCuratedRecipesFromCorpus } from '../curatedRecipes.js';
import { loadIngredientCanonicaliser } from './ingredientCanonicaliser.js';
import { toRecipeIngredientInsert } from './recipeIngredientInput.js';
import { createCreateHouseholdHandler } from './createHousehold.js';

/**
 * Generous ceiling for seeding the full curated corpus (about 200 recipes and
 * 2,200 ingredient rows) in one `createHousehold`. Local runs take well under
 * 2s since the seeding is batched; the old row-by-row path took far longer.
 * The ceiling is loose so a slow CI box does not flake, but low enough that a
 * regression to per-row inserts is caught.
 */
const SEEDING_CEILING_MS = 8_000;

/** Ceiling on SQL statements for a whole seeded `createHousehold`; per-row seeding issues about 2,400. */
const MAX_STATEMENTS = 60;

/** A pool whose checked-out clients count every `query` call. */
const countingPool = (pool: Pool, counter: { count: number }): Pool =>
  new Proxy(pool, {
    get: (target, prop, receiver) => {
      if (prop !== 'connect') {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      return async (...callbackArgs: unknown[]) => {
        if (callbackArgs.length > 0) {
          // `pool.query` internals use the callback form; those calls are outside the seeding transaction.
          return (target.connect as (...args: unknown[]) => unknown)(...callbackArgs);
        }
        const client = await target.connect();
        const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
        (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
          counter.count += 1;
          return originalQuery(...args);
        };
        return client;
      };
    },
  });

const buildEvent = (name: string, sub: string): AppSyncResolverEvent<{ name: unknown }> => ({
  arguments: { name },
  identity: {
    sub,
    issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
    username: sub,
    claims: { email: `${sub}@example.test` },
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
  } as unknown as AppSyncResolverEvent<{ name: unknown }>['identity'],
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

describe('createHousehold full-corpus seeding', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
    await syncCatalog(db.adminClient, catalogBundle);
    resetCatalogCacheForTesting();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  it('seeds the whole corpus quickly, with canonical ingredients identical to the per-row path', async () => {
    const counter = { count: 0 };
    const counted = countingPool(pool, counter);
    const handler = createCreateHouseholdHandler({ getPool: async () => counted, getCuratedRecipes: getCuratedRecipesFromCorpus });
    const corpus = getCuratedRecipesFromCorpus();

    const started = performance.now();
    const household = await handler(buildEvent('Seeded House', 'sub-seeding-perf'));
    const elapsedMs = Math.round(performance.now() - started);
    process.stdout.write(`createHousehold seeded ${corpus.length} recipes in ${elapsedMs}ms with ${counter.count} statements\n`);

    expect(elapsedMs).toBeLessThan(SEEDING_CEILING_MS);
    expect(counter.count).toBeLessThan(MAX_STATEMENTS);

    const recipeCount = await db.adminClient.query('SELECT 1 FROM recipes WHERE household_id = $1', [household.id]);
    expect(recipeCount.rowCount).toBe(corpus.length);

    const canonicaliser = await loadIngredientCanonicaliser(pool);
    const expected = corpus
      .flatMap((recipe) =>
        recipe.ingredients.map((ingredient, index) => {
          const row = toRecipeIngredientInsert('x', ingredient, index, canonicaliser);
          return [recipe.title, row.sortOrder, row.name, row.quantity, row.unit, row.category, row.notes, row.isStaple, row.ingredientId, row.catalogMatch].join('|');
        }),
      )
      .sort();

    const stored = await db.adminClient.query<Record<string, unknown>>(
      `SELECT r.title, i.sort_order, i.name, i.quantity::float8 AS quantity, i.unit, i.category, i.notes, i.is_staple, i.ingredient_id, i.catalog_match
         FROM recipe_ingredients i JOIN recipes r ON r.id = i.recipe_id WHERE r.household_id = $1`,
      [household.id],
    );
    const actual = stored.rows
      .map((row) => [row.title, row.sort_order, row.name, row.quantity, row.unit, row.category, row.notes, row.is_staple, row.ingredient_id, row.catalog_match].join('|'))
      .sort();

    expect(actual).toEqual(expected);
    expect(stored.rows.some((row) => row.ingredient_id !== null)).toBe(true);
  }, 60_000);
});
