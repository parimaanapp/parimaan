import { canonicalizePantryUnit } from './pantryUnits.js';
import { convertQuantity } from './unitConversion.js';

/** A single recipe ingredient as `generateShoppingList`'s resolver reads it from `recipe_ingredients` — free text `name`/`unit`/`category` (PRD §9), matching `recipe_ingredients`'s real DDL. */
export interface RecipeIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  isStaple: boolean;
}

export interface AggregationRecipe {
  id: string;
  servings: number;
  ingredients: readonly RecipeIngredient[];
}

export type RecipesById = ReadonlyMap<string, AggregationRecipe>;

/** The subset of a `menu_items` row `aggregateIngredients` needs — `servingsOverride` scales that row's recipe before its ingredients are summed. */
export interface AggregationMenuItem {
  dayOfWeek: number;
  mealSlot: string;
  recipeId: string;
  servingsOverride: number | null;
}

/** One merged line of the shopping list. `sourceRecipeId` is the first recipe that contributed to this group — D8's origin marker (`source_recipe_id IS NOT NULL`) needs only "came from a recipe," not every contributor. */
export interface AggregatedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  sourceRecipeId: string;
}

export interface PantryItemForSubtraction {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface CategorizedGroup {
  category: string;
  items: readonly AggregatedIngredient[];
}

/** PRD §9's exact three-part OR (line 414): unit in this set, regardless of anything else. */
const STAPLE_UNITS: ReadonlySet<string> = new Set(['tsp', 'tbsp', 'pinch', 'to_taste']);

/**
 * PRD §9's third OR branch. `recipe_ingredients.category` is free TEXT, not
 * a closed enum (same as `recipe_ingredients`'s own DDL, `1787808112003_recipes.ts`)
 * — this set is a separate vocabulary from `pantryCategories.ts`'s
 * `KNOWN_PANTRY_CATEGORIES` (which governs `pantry_items.category`, a
 * different table with different values, e.g. no "masala"/"salt" there).
 * Exported as the default for `isStapleExcluded`'s second parameter so a
 * caller/test can inject a different set without editing this module —
 * the same "named, re-tunable constant" convention `rotationSelection.ts`
 * established for `RECENCY_WINDOW_WEEKS`.
 */
export const STAPLE_CATEGORIES: ReadonlySet<string> = new Set(['spice', 'masala', 'salt', 'oil']);

/**
 * PRD §9's staples-exclusion rule (E2E_MVP_PLAN.md §17.3 S1): excluded if
 * `unit ∈ {tsp, tbsp, pinch, to_taste}` OR `is_staple = true` OR
 * `category ∈ {spice, masala, salt, oil}` — three independent OR branches,
 * any one of which is sufficient on its own.
 */
export const isStapleExcluded = (
  ingredient: RecipeIngredient,
  stapleCategories: ReadonlySet<string> = STAPLE_CATEGORIES,
): boolean => {
  if (ingredient.isStaple) {
    return true;
  }
  if (ingredient.unit !== null && STAPLE_UNITS.has(ingredient.unit.trim().toLowerCase())) {
    return true;
  }
  if (ingredient.category !== null && stapleCategories.has(ingredient.category.trim().toLowerCase())) {
    return true;
  }
  return false;
};

/**
 * D2's locked similarity threshold (E2E_MVP_PLAN.md §17.2.2) — a named,
 * exported, module-level constant rather than a magic number inline, so
 * it's re-tunable later without touching `aggregateIngredients` itself,
 * the same convention `rotationSelection.ts` established for
 * `RECENCY_WINDOW_WEEKS`.
 */
export const INGREDIENT_SIMILARITY_THRESHOLD = 0.75;

const normalize = (raw: string): string => raw.trim().toLowerCase();

/** Character-bigram multiset of a (lowercased, trimmed) string, counting repeats — e.g. "onion" -> {on: 2, ni: 1, io: 1}. */
const bigramCounts = (value: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const bigram = value.slice(i, i + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
};

/**
 * Sørensen–Dice coefficient over character bigrams (D2, §17.2.2):
 * `2·|bigrams(A)∩bigrams(B)| / (|bigrams(A)|+|bigrams(B)|)`, intersection
 * taken as a multiset (repeated bigrams count up to their shared
 * multiplicity). Chosen over Jaro-Winkler/Levenshtein-ratio specifically
 * because it penalizes length mismatch between short tokens, which is what
 * keeps "onion" (Dice ≈ 0.89 against "onions") correctly separated from
 * "onion powder" (Dice ≈ 0.53 against "onion") without a hand-tuned length
 * guard. Both inputs must already be normalized (`normalize`) — this
 * function does no trimming/casing of its own.
 */
const diceCoefficient = (a: string, b: string): number => {
  if (a === b) {
    return 1;
  }
  const totalA = a.length - 1;
  const totalB = b.length - 1;
  if (totalA <= 0 || totalB <= 0) {
    // Neither string has a bigram to compare (length 0 or 1) and they
    // aren't byte-identical — no meaningful overlap to compute.
    return 0;
  }
  const countsA = bigramCounts(a);
  const countsB = bigramCounts(b);
  let intersection = 0;
  for (const [bigram, countA] of countsA) {
    const countB = countsB.get(bigram);
    if (countB !== undefined) {
      intersection += Math.min(countA, countB);
    }
  }
  return (2 * intersection) / (totalA + totalB);
};

/** Two already-normalized names are the same ingredient if byte-identical or at/above `INGREDIENT_SIMILARITY_THRESHOLD`. */
const namesMatch = (normalizedA: string, normalizedB: string): boolean =>
  normalizedA === normalizedB || diceCoefficient(normalizedA, normalizedB) >= INGREDIENT_SIMILARITY_THRESHOLD;

/**
 * D2's unit gate (§17.2.2 point 3): fuzzy name-matching never crosses a
 * unit boundary on its own. Two canonical units are compatible if they're
 * identical (including both `null` — two "no unit given" ingredients) or
 * convertible under D3's `convertQuantity` table. Reused by
 * `aggregateIngredients`' clustering and `subtractPantry`'s pantry match,
 * keeping D2 and D3 composable rather than two independently-reasoned
 * rules (§17.2.2 point 3's own stated intent).
 */
const unitsCompatible = (canonicalA: string | null, canonicalB: string | null): boolean => {
  if (canonicalA === canonicalB) {
    return true;
  }
  if (canonicalA === null || canonicalB === null) {
    return false;
  }
  return convertQuantity(1, canonicalA, canonicalB) !== null;
};

interface IngredientGroup {
  representativeName: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  sourceRecipeId: string;
}

/**
 * Sums `existingQuantity` (already in `existingUnit`) with `incomingQuantity`
 * (in `incomingUnit`), converting the incoming amount into `existingUnit`
 * first when the units differ (D3, only ever called once `unitsCompatible`
 * has already confirmed they're in the same family). Either quantity being
 * `null` (an unparseable recipe amount, e.g. "to taste") makes the merged
 * total unknown rather than silently dropping the unknown side — `null`
 * propagates, it never gets treated as 0.
 */
const mergeQuantities = (
  existingQuantity: number | null,
  existingUnit: string | null,
  incomingQuantity: number | null,
  incomingUnit: string | null,
): number | null => {
  if (existingQuantity === null || incomingQuantity === null) {
    return null;
  }
  if (existingUnit === incomingUnit) {
    return existingQuantity + incomingQuantity;
  }
  if (existingUnit === null || incomingUnit === null) {
    // Unreachable in practice — `unitsCompatible` already required both
    // non-null to get here when the canonical units differ — but this
    // stays a defensive `null` rather than an unsafe cast.
    return null;
  }
  const convertedIncoming = convertQuantity(incomingQuantity, incomingUnit, existingUnit);
  return convertedIncoming === null ? null : existingQuantity + convertedIncoming;
};

/** `orderedItems`' own sort comparator: menu day, then meal slot — the first two levels of D2's "menu day -> meal -> recipe -> ingredient index" order. `Array.prototype.sort` is stable since ES2019, so ties keep the caller's own relative order, which is where the "recipe -> ingredient index" levels come from. */
const compareByDayThenMeal = (a: AggregationMenuItem, b: AggregationMenuItem): number => {
  if (a.dayOfWeek !== b.dayOfWeek) {
    return a.dayOfWeek - b.dayOfWeek;
  }
  return a.mealSlot.localeCompare(b.mealSlot);
};

/**
 * Assigns one already-scaled, non-staple ingredient occurrence to `groups`
 * — merging into the first matching group (D2's greedy clustering) or
 * appending a new one — returning a new array rather than mutating
 * `groups` in place.
 */
const assignIngredientToGroups = (
  groups: readonly IngredientGroup[],
  raw: RecipeIngredient,
  recipeId: string,
  scale: number,
): IngredientGroup[] => {
  const normalizedName = normalize(raw.name);
  const canonicalUnit = raw.unit === null ? null : canonicalizePantryUnit(raw.unit);
  const scaledQuantity = raw.quantity === null ? null : raw.quantity * scale;
  const category = raw.category === null ? null : raw.category.trim();

  const matchIndex = groups.findIndex(
    (group) => namesMatch(group.normalizedName, normalizedName) && unitsCompatible(group.unit, canonicalUnit),
  );

  if (matchIndex === -1) {
    return [
      ...groups,
      {
        representativeName: raw.name.trim(),
        normalizedName,
        quantity: scaledQuantity,
        unit: canonicalUnit,
        category,
        sourceRecipeId: recipeId,
      },
    ];
  }

  const existing = groups[matchIndex]!;
  const merged: IngredientGroup = {
    ...existing,
    quantity: mergeQuantities(existing.quantity, existing.unit, scaledQuantity, canonicalUnit),
  };
  return [...groups.slice(0, matchIndex), merged, ...groups.slice(matchIndex + 1)];
};

/**
 * D2's normalize-then-fuzzy-cluster pipeline (§17.2.2), unit-gated per D3
 * (§17.2.3), scaling each recipe's ingredients by that menu item's own
 * `servingsOverride` first when present. Walks occurrences in a stable,
 * deterministic order — menu day, then meal slot, then the caller's own
 * `menuItems` order (recipe/ingredient index) within that — and greedily
 * assigns each occurrence to the first existing group it matches, else
 * starts a new one (§17.2.2 point 4's documented, bounded simplification,
 * not full pairwise clustering).
 */
export const aggregateIngredients = (
  menuItems: readonly AggregationMenuItem[],
  recipesById: RecipesById,
): AggregatedIngredient[] => {
  const orderedItems = [...menuItems].sort(compareByDayThenMeal);

  let groups: IngredientGroup[] = [];

  for (const item of orderedItems) {
    const recipe = recipesById.get(item.recipeId);
    if (recipe === undefined) {
      // `menu_items.recipe_id` is FK-enforced against `recipes`, so this
      // is unreachable against real data — skipped defensively rather
      // than thrown, consistent with a pure function that never assumes
      // its caller passed a fully-consistent snapshot.
      continue;
    }

    // `recipe.servings > 0` is a DB-constrained invariant (`recipes.servings
    // NOT NULL DEFAULT 4`), so the `recipe.servings > 0` guard is defensive
    // only — a `servingsOverride` paired with a genuinely-zero `servings`
    // falls back to an unscaled `1` rather than dividing by zero, the same
    // "never assume a fully-consistent snapshot" stance this function takes
    // for a missing `recipe` just above.
    const scale = item.servingsOverride !== null && recipe.servings > 0 ? item.servingsOverride / recipe.servings : 1;

    for (const raw of recipe.ingredients) {
      if (!isStapleExcluded(raw)) {
        groups = assignIngredientToGroups(groups, raw, recipe.id, scale);
      }
    }
  }

  return groups.map((group) => ({
    name: group.representativeName,
    quantity: group.quantity,
    unit: group.unit,
    category: group.category,
    sourceRecipeId: group.sourceRecipeId,
  }));
};

/**
 * Finds the pantry row (if any) matching `item` by D2's fuzzy-name rule,
 * unit-gated per D3. Returns at most one row — the first match in
 * `pantryItems`' own order — even if several pantry rows would fuzzy/unit
 * match the same aggregated line (e.g. separate "onion" and "onions" rows,
 * or the same ingredient stocked in both `g` and `kg`). A household
 * splitting one ingredient's stock across multiple pantry rows is
 * expected to be rare, and summing every match would need its own
 * cross-row unit-conversion pass; treated as a documented, bounded
 * simplification for this slice rather than built speculatively, the same
 * "not full pairwise clustering" scoping `assignIngredientToGroups` uses.
 */
const findMatchingPantryItem = (
  item: AggregatedIngredient,
  pantryItems: readonly PantryItemForSubtraction[],
): PantryItemForSubtraction | undefined => {
  const normalizedItemName = normalize(item.name);
  return pantryItems.find((pantryItem) => {
    const pantryCanonicalUnit = pantryItem.unit === null ? null : canonicalizePantryUnit(pantryItem.unit);
    return namesMatch(normalize(pantryItem.name), normalizedItemName) && unitsCompatible(item.unit, pantryCanonicalUnit);
  });
};

/** `match`'s quantity expressed in `item`'s own unit, or `null` if that conversion is impossible (defensive — `findMatchingPantryItem` already required the two units be compatible). */
const pantryQuantityInItemUnit = (item: AggregatedIngredient, match: PantryItemForSubtraction): number | null => {
  const pantryCanonicalUnit = match.unit === null ? null : canonicalizePantryUnit(match.unit);
  if (item.unit === pantryCanonicalUnit) {
    return match.quantity;
  }
  if (item.unit === null || pantryCanonicalUnit === null || match.quantity === null) {
    return null;
  }
  return convertQuantity(match.quantity, pantryCanonicalUnit, item.unit);
};

/**
 * A same-family cross-unit conversion (`convertQuantity`) divides by a
 * decimal approximation (e.g. `tsp: 4.9289`), so a pantry quantity that
 * should exactly cover a recipe's need can leave a residual on the order
 * of `1e-12` instead of exactly `0` after the round-trip. Treating
 * anything at or below this epsilon as "fully covered" keeps the
 * documented "never shown as a zero or negative amount" contract honest
 * against floating-point noise, not just against a mathematically exact
 * subtraction.
 */
const SUBTRACTION_EPSILON = 1e-9;

/** D3's reduction for one aggregated line: the line unchanged (full quantity) if unmatched or unconvertible, `null` if fully covered (dropped, never shown as zero/negative), or the line with its remaining quantity otherwise. */
const subtractOneLine = (item: AggregatedIngredient, pantryItems: readonly PantryItemForSubtraction[]): AggregatedIngredient | null => {
  const match = findMatchingPantryItem(item, pantryItems);
  if (match === undefined || item.quantity === null || match.quantity === null) {
    return item;
  }

  const covered = pantryQuantityInItemUnit(item, match);
  if (covered === null) {
    return item;
  }

  const remaining = item.quantity - covered;
  return remaining > SUBTRACTION_EPSILON ? { ...item, quantity: remaining } : null;
};

/**
 * D3's conversion-table-aware reduction (§17.2.3): each aggregated line is
 * matched against `pantryItems` by D2's same fuzzy-name rule, unit-gated
 * per D3. A match with an unknown quantity on either side, or a genuinely
 * unmatched line, is returned unchanged (full recipe-required quantity).
 * A matched line's pantry quantity is converted into the aggregated
 * line's own unit before subtracting; a result at or below zero drops the
 * line entirely rather than surfacing a zero or negative "buy" amount.
 */
export const subtractPantry = (
  aggregated: readonly AggregatedIngredient[],
  pantryItems: readonly PantryItemForSubtraction[],
): AggregatedIngredient[] => {
  const result: AggregatedIngredient[] = [];
  for (const item of aggregated) {
    const subtracted = subtractOneLine(item, pantryItems);
    if (subtracted !== null) {
      result.push(subtracted);
    }
  }
  return result;
};

/**
 * Groups aggregated items by category for display, `null` bucketed under
 * `"other"`. Categories appear in first-seen order; items keep their
 * original relative order within a category. Buckets on the trimmed but
 * NOT case-folded category value (`assignIngredientToGroups` only trims,
 * unlike `isStapleExcluded`'s own `.toLowerCase()` check) — currently
 * unreachable in practice, since `recipe_ingredients.category` has no live
 * write path yet (`api/src/validation/recipes.ts` doesn't accept it, and
 * the mobile ingredient editor doesn't expose it), so every real category
 * is `null` today. Whichever future slice makes `category` user-writable
 * should revisit this: a `"Produce"`/`"produce"` split would render as two
 * separate headers, the same class of case-sensitivity bug D2's fuzzy-name
 * matching was designed to avoid for ingredient names.
 */
export const categorize = (items: readonly AggregatedIngredient[]): CategorizedGroup[] => {
  const order: string[] = [];
  const byCategory = new Map<string, AggregatedIngredient[]>();

  for (const item of items) {
    const key = item.category ?? 'other';
    const existing = byCategory.get(key);
    if (existing === undefined) {
      order.push(key);
      byCategory.set(key, [item]);
    } else {
      byCategory.set(key, [...existing, item]);
    }
  }

  return order.map((category) => ({ category, items: byCategory.get(category)! }));
};
