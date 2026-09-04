import { canonicalizePantryUnit } from './pantryUnits.js';
import { convertQuantity } from './unitConversion.js';
import { SUBTRACTION_EPSILON, isStapleExcluded, namesMatch, normalizeIngredientName, unitsCompatible } from './shoppingListGeneration.js';
import type { RecipeIngredient } from './shoppingListGeneration.js';

/**
 * The subset of a recipe `markMade`'s resolver needs — `servings` is
 * required alongside `ingredients` because `servingsOverride` scaling
 * (§18.2.2/D2) is computed the same way `aggregateIngredients` computes it:
 * `servingsOverride / recipe.servings`. Without the recipe's own base
 * `servings`, that ratio cannot be reproduced — the E2E_MVP_PLAN.md §18.3
 * S1 prose shorthand ("computeDeductionLines(ingredients, servingsOverride,
 * pantryItems)") is this type's `ingredients` field plus the `servings` it
 * needs to scale against, not a bare array.
 */
export interface DeductionRecipe {
  servings: number;
  ingredients: readonly RecipeIngredient[];
}

/**
 * The subset of a `pantry_items` row deduction needs to match against and,
 * on a match, write back — `id` (unlike `shoppingListGeneration.ts`'s own
 * `PantryItemForSubtraction`, which never needs to identify a specific row
 * since it only ever computes a "still need to buy" quantity, never a
 * write).
 */
export interface PantryItemForDeduction {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

/**
 * One output line per recipe ingredient, in the same order as
 * `recipe.ingredients` (D2/D3, §18.2.2/§18.2.3): `{ pantryItemId, newQuantity }`
 * for an ingredient that matched a real pantry row and should decrement it
 * to `newQuantity` (already zero-floored, O1); `{ pantryItemId: null }` for
 * everything else — a staple-excluded ingredient, an ingredient with no
 * matching pantry row, a "name matches but unit doesn't convert" case, or
 * (per `findMatchingPantryItem`'s "first match wins" simplification,
 * mirroring `shoppingListGeneration.ts`'s own `findMatchingPantryItem`
 * doc) a match whose `quantity` is `null` even though a second pantry row
 * would otherwise match too — all are a no-op, never a fabricated new row
 * (D3).
 */
export type DeductionLine = { pantryItemId: string; newQuantity: number } | { pantryItemId: null };

const NO_OP_LINE: DeductionLine = { pantryItemId: null };

/**
 * Finds the pantry row (if any) matching a recipe ingredient's already-
 * normalized name and canonical unit, reusing D2's exact fuzzy-name
 * (`namesMatch`) and unit-compatibility (`unitsCompatible`) rules — the
 * mirror image of `shoppingListGeneration.ts`'s own `findMatchingPantryItem`,
 * over `PantryItemForDeduction` instead of `PantryItemForSubtraction` since
 * a write needs the row's `id`.
 */
const findMatchingPantryItem = (
  normalizedName: string,
  canonicalUnit: string | null,
  pantryItems: readonly PantryItemForDeduction[],
): PantryItemForDeduction | undefined =>
  pantryItems.find((pantryItem) => {
    const pantryCanonicalUnit = pantryItem.unit === null ? null : canonicalizePantryUnit(pantryItem.unit);
    return namesMatch(normalizeIngredientName(pantryItem.name), normalizedName) && unitsCompatible(canonicalUnit, pantryCanonicalUnit);
  });

/**
 * `requiredQuantity` (already in `canonicalUnit`) expressed in `match`'s own
 * unit, or `null` if that conversion is impossible — mirrors
 * `shoppingListGeneration.ts`'s own `pantryQuantityInItemUnit`, just
 * converting in the opposite direction (recipe requirement -> pantry unit,
 * rather than pantry stock -> recipe unit).
 */
const requiredInPantryUnit = (requiredQuantity: number, canonicalUnit: string | null, pantryCanonicalUnit: string | null): number | null => {
  if (canonicalUnit === pantryCanonicalUnit) {
    return requiredQuantity;
  }
  if (canonicalUnit === null || pantryCanonicalUnit === null) {
    // Unreachable in practice — `unitsCompatible` already gated the match
    // that got us here — but stays a defensive `null` rather than an unsafe
    // non-null assertion, mirroring `mergeQuantities`'s own defensive branch.
    return null;
  }
  return convertQuantity(requiredQuantity, canonicalUnit, pantryCanonicalUnit);
};

/**
 * D2/D3's per-ingredient pipeline: staple filter first (O2), then match,
 * then convert-and-clamp (O1). A staple-excluded ingredient never reaches
 * the matcher at all — the same order `aggregateIngredients` uses.
 */
const computeOneLine = (ingredient: RecipeIngredient, scale: number, pantryItems: readonly PantryItemForDeduction[]): DeductionLine => {
  if (isStapleExcluded(ingredient) || ingredient.quantity === null) {
    return NO_OP_LINE;
  }

  const normalizedName = normalizeIngredientName(ingredient.name);
  const canonicalUnit = ingredient.unit === null ? null : canonicalizePantryUnit(ingredient.unit);
  const match = findMatchingPantryItem(normalizedName, canonicalUnit, pantryItems);
  if (match === undefined || match.quantity === null) {
    return NO_OP_LINE;
  }

  const pantryCanonicalUnit = match.unit === null ? null : canonicalizePantryUnit(match.unit);
  const required = requiredInPantryUnit(ingredient.quantity * scale, canonicalUnit, pantryCanonicalUnit);
  if (required === null) {
    return NO_OP_LINE;
  }

  const remaining = match.quantity - required;
  return {
    pantryItemId: match.id,
    // O1 (§18.2.3, locked): never negative — reuses `subtractPantry`'s own
    // `Math.max(0, ...)` idiom, adapted for a stored quantity rather than a
    // dropped shopping-list line. `SUBTRACTION_EPSILON`-gated first, the
    // same way `subtractOneLine` guards its own subtraction, since a
    // cross-unit `convertQuantity` round-trip can leave a `~1e-12` residual
    // instead of an exact `0` — without this, a row that should read
    // exactly zero could persist as a near-zero float forever.
    newQuantity: Math.max(0, Math.abs(remaining) <= SUBTRACTION_EPSILON ? 0 : remaining),
  };
};

/**
 * D2/D3's full pantry-deduction computation (§18.2.2/§18.2.3): scales
 * `recipe.ingredients` by `servingsOverride` (identical to
 * `aggregateIngredients`'s own scaling — `servingsOverride / recipe.servings`
 * when `servingsOverride` is present and `recipe.servings > 0`, else `1`),
 * then reduces each ingredient to one `DeductionLine`, in order. Pure — no
 * I/O, no mutation of `pantryItems`.
 */
export const computeDeductionLines = (
  recipe: DeductionRecipe,
  servingsOverride: number | null,
  pantryItems: readonly PantryItemForDeduction[],
): DeductionLine[] => {
  const scale = servingsOverride !== null && recipe.servings > 0 ? servingsOverride / recipe.servings : 1;
  return recipe.ingredients.map((ingredient) => computeOneLine(ingredient, scale, pantryItems));
};
