import type { CatalogMatch, IngredientCanonicaliser } from './canonicaliseIngredient.js';

/**
 * Pure planning half of the B2b backfill (`catalog/backfillIngredients.ts`
 * does the I/O). Each function returns the full new state of a row, or `null`
 * when the row is already in that state, so running the backfill twice is a
 * no-op by construction: canonical names re-resolve to themselves and an
 * already-converted unit is an allowed unit.
 */

export interface RecipeIngredientBackfillRow {
  readonly id: string;
  readonly name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly notes: string | null;
  readonly ingredientId: string | null;
  readonly catalogMatch: CatalogMatch | null;
}

export type RecipeIngredientUpdate = RecipeIngredientBackfillRow;

export interface PantryBackfillRow {
  readonly id: string;
  readonly name: string;
  readonly ingredientId: string | null;
  readonly catalogMatch: CatalogMatch | null;
}

export type PantryUpdate = PantryBackfillRow;

export const planRecipeIngredientBackfill = (
  row: RecipeIngredientBackfillRow,
  canonicaliser: IngredientCanonicaliser,
): RecipeIngredientUpdate | null => {
  const line = canonicaliser.recipeLine({
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes,
  });
  // The catalog was not consulted (identity canonicaliser): nothing to plan.
  if (line.catalogMatch === null) {
    return null;
  }
  const next: RecipeIngredientUpdate = {
    id: row.id,
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    notes: line.notes,
    ingredientId: line.ingredientId,
    catalogMatch: line.catalogMatch,
  };
  const unchanged =
    next.name === row.name &&
    next.quantity === row.quantity &&
    next.unit === row.unit &&
    next.notes === row.notes &&
    next.ingredientId === row.ingredientId &&
    next.catalogMatch === row.catalogMatch;
  return unchanged ? null : next;
};

export const planPantryBackfill = (
  row: PantryBackfillRow,
  canonicaliser: IngredientCanonicaliser,
): PantryUpdate | null => {
  const resolved = canonicaliser.pantryItem(row.name);
  if (resolved.catalogMatch === null) {
    return null;
  }
  const unchanged =
    resolved.name === row.name &&
    resolved.ingredientId === row.ingredientId &&
    resolved.catalogMatch === row.catalogMatch;
  return unchanged
    ? null
    : { id: row.id, name: resolved.name, ingredientId: resolved.ingredientId, catalogMatch: resolved.catalogMatch };
};
