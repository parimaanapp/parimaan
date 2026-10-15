import { categoryLabel } from '../domain/ingredientCatalog.js';
import type { CatalogEntry } from '../domain/ingredientCatalog.js';

/**
 * GraphQL `CatalogIngredient`. `aliases` carries the full list; the schema's
 * `aliases(limit:)` argument is applied by AppSync's own response mapping
 * (no Lambda per item), not here.
 */
export interface GraphQLCatalogIngredient {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  allowedUnits: string[];
  defaultUnit: string;
  aliases: string[];
}

export const toGraphQLCatalogIngredient = (entry: CatalogEntry): GraphQLCatalogIngredient => ({
  id: entry.id,
  name: entry.canonicalName,
  category: entry.appCategory,
  categoryLabel: categoryLabel(entry.appCategory),
  allowedUnits: [...entry.allowedUnits],
  defaultUnit: entry.defaultUnit,
  aliases: [...entry.aliases],
});
