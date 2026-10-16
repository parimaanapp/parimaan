import type { Pool, PoolClient } from 'pg';
import type { IngredientCanonicaliser } from '../domain/canonicaliseIngredient.js';
import type { CuratedRecipeInput } from '../curatedRecipes.js';
import { assertCanBypassRowSecurity } from './backfillIngredients.js';
import { insertRecipesWithIngredients } from '../repositories/recipeBulkRepository.js';
import { toBulkCuratedRecipe } from '../resolvers/curatedRecipeSeed.js';

/**
 * Existing-household top-up: adds the curated recipes a household is missing
 * (corpus grew after it was created). A recipe counts as already present when
 * the household has one with the same title and role (case- and
 * whitespace-insensitive), whatever its source, so a user's own copy is never
 * duplicated. Idempotent: a second run adds nothing.
 *
 * Each household is processed in its own transaction under a transaction-level
 * advisory lock (per household id), so two concurrent runs cannot both add the
 * same recipes. It reads and writes across all households, so it must run as a
 * role that bypasses RLS (superuser / BYPASSRLS), like the backfill.
 * Dry run (`execute: false`) only reads. New rows are created exactly like
 * `createHousehold` seeding: `source_type = 'curated'`, owned by the
 * household's primary user, ingredients canonicalised through the catalog.
 */

export interface TopUpOptions {
  readonly pool: Pool;
  readonly recipes: readonly CuratedRecipeInput[];
  readonly canonicaliser: IngredientCanonicaliser;
  readonly execute: boolean;
}

export interface HouseholdTopUp {
  readonly householdId: string;
  readonly missing: number;
}

export interface TopUpReport {
  readonly executed: boolean;
  readonly households: number;
  readonly householdsToTopUp: number;
  /** Recipes that a dry run would insert (also set after execute: what was planned). */
  readonly recipesToAdd: number;
  /** Recipes actually inserted; always 0 for a dry run. */
  readonly recipesAdded: number;
  readonly perHousehold: readonly HouseholdTopUp[];
}

/** Arbitrary constant namespacing this top-up's per-household advisory locks (the backfill uses 7_204_002). */
const TOPUP_LOCK_NAMESPACE = 7_204_003;

const recipeKey = (title: string, role: string): string => `${title.trim().replace(/\s+/g, ' ').toLowerCase()}|${role}`;

interface HouseholdRef {
  readonly id: string;
  readonly primary_user_id: string;
}

const existingKeys = async (client: PoolClient, householdId: string): Promise<Set<string>> => {
  const result = await client.query<{ title: string; role: string }>(
    'SELECT title, role FROM recipes WHERE household_id = $1',
    [householdId],
  );
  return new Set(result.rows.map((row) => recipeKey(row.title, row.role)));
};

/** Corpus recipes the household lacks, in corpus order, each (title, role) at most once. */
const missingFor = (recipes: readonly CuratedRecipeInput[], present: ReadonlySet<string>): CuratedRecipeInput[] => {
  const seen = new Set(present);
  return recipes.filter((recipe) => {
    const key = recipeKey(recipe.title, recipe.role);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const topUpHousehold = async (
  pool: Pool,
  household: HouseholdRef,
  options: TopUpOptions,
): Promise<{ missing: number; added: number }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (options.execute) {
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [TOPUP_LOCK_NAMESPACE, household.id]);
    }
    // Read after the lock so a concurrent run's inserts are visible.
    const missing = missingFor(options.recipes, await existingKeys(client, household.id));
    if (options.execute && missing.length > 0) {
      await insertRecipesWithIngredients(
        client,
        missing.map((recipe) => toBulkCuratedRecipe(household.id, recipe, household.primary_user_id, options.canonicaliser)),
      );
    }
    await client.query('COMMIT');
    return { missing: missing.length, added: options.execute ? missing.length : 0 };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const topUpCuratedRecipes = async (options: TopUpOptions): Promise<TopUpReport> => {
  await assertCanBypassRowSecurity(options.pool);
  const households = await options.pool.query<HouseholdRef>(
    'SELECT id, primary_user_id FROM households ORDER BY created_at, id',
  );
  const perHousehold: HouseholdTopUp[] = [];
  let recipesAdded = 0;
  for (const household of households.rows) {
    const result = await topUpHousehold(options.pool, household, options);
    recipesAdded += result.added;
    perHousehold.push({ householdId: household.id, missing: result.missing });
  }
  return {
    executed: options.execute,
    households: households.rows.length,
    householdsToTopUp: perHousehold.filter((entry) => entry.missing > 0).length,
    recipesToAdd: perHousehold.reduce((sum, entry) => sum + entry.missing, 0),
    recipesAdded,
    perHousehold,
  };
};

export const formatTopUpReport = (report: TopUpReport): string =>
  [
    `Curated recipe top-up (${report.executed ? 'EXECUTED' : 'dry run'})`,
    `  households scanned:     ${report.households}`,
    `  households needing add: ${report.householdsToTopUp}`,
    `  recipes missing:        ${report.recipesToAdd}`,
    `  recipes inserted:       ${report.recipesAdded}`,
  ].join('\n');
