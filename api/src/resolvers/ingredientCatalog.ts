import type { AppSyncResolverEvent } from 'aws-lambda';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { ValidationError } from '../errors.js';
import { toGraphQLCatalogIngredient } from '../mappers/catalogIngredient.js';
import type { GraphQLCatalogIngredient } from '../mappers/catalogIngredient.js';
import { loadCatalog } from '../repositories/catalogRepository.js';
import type { CatalogSnapshot } from '../repositories/catalogRepository.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface CatalogResolverDeps {
  getCatalog: () => Promise<CatalogSnapshot>;
}

export const productionDeps: CatalogResolverDeps = {
  getCatalog: async () => loadCatalog(await getPool()),
};

const MAX_CATEGORY_LENGTH = 40;

interface IngredientCatalogArgs {
  category?: string | null;
}

/**
 * `Query.ingredientCatalog(category)`: the whole ingredient catalog, or one
 * category of it. Global reference data, so there is no household check, but
 * the caller must be authenticated. An unknown category is an empty list, not
 * an error, so an older client sending a retired category degrades quietly.
 */
export const createIngredientCatalogHandler =
  (deps: CatalogResolverDeps) =>
  async (event: AppSyncResolverEvent<IngredientCatalogArgs>): Promise<GraphQLCatalogIngredient[]> => {
    extractCallerIdentity(event.identity);

    const rawCategory = event.arguments.category;
    const category = typeof rawCategory === 'string' ? rawCategory.trim().toLowerCase() : '';
    if (category.length > MAX_CATEGORY_LENGTH) {
      throw new ValidationError(`category must be at most ${MAX_CATEGORY_LENGTH} characters`);
    }

    const { entries } = await deps.getCatalog();
    return entries
      .filter((entry) => category === '' || entry.appCategory === category)
      .map(toGraphQLCatalogIngredient)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  };

export const handler = withErrorHandling(createIngredientCatalogHandler(productionDeps));
