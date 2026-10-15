import type { AppSyncResolverEvent } from 'aws-lambda';
import { extractCallerIdentity } from '../auth/identity.js';
import { searchCatalog } from '../domain/ingredientCatalog.js';
import { ValidationError } from '../errors.js';
import { toGraphQLCatalogIngredient } from '../mappers/catalogIngredient.js';
import type { GraphQLCatalogIngredient } from '../mappers/catalogIngredient.js';
import { productionDeps } from './ingredientCatalog.js';
import type { CatalogResolverDeps } from './ingredientCatalog.js';
import { withErrorHandling } from './withErrorHandling.js';

const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 20;

interface SearchIngredientsArgs {
  query: string;
  limit?: number | null;
}

/**
 * `Query.searchIngredients(query, limit)`: ranked name/alias search used by
 * add-item pickers. `limit` is clamped by `searchCatalog` (1..50) rather than
 * rejected; a blank query returns an empty list.
 */
export const createSearchIngredientsHandler =
  (deps: CatalogResolverDeps) =>
  async (event: AppSyncResolverEvent<SearchIngredientsArgs>): Promise<GraphQLCatalogIngredient[]> => {
    extractCallerIdentity(event.identity);

    const { query, limit } = event.arguments;
    if (typeof query !== 'string') {
      throw new ValidationError('query must be a string');
    }
    if (query.length > MAX_QUERY_LENGTH) {
      throw new ValidationError(`query must be at most ${MAX_QUERY_LENGTH} characters`);
    }

    const { index } = await deps.getCatalog();
    const effectiveLimit = typeof limit === 'number' ? limit : DEFAULT_LIMIT;
    return searchCatalog(query, index, effectiveLimit).map(toGraphQLCatalogIngredient);
  };

export const handler = withErrorHandling(createSearchIngredientsHandler(productionDeps));
