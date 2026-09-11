import { createHash } from 'node:crypto';

/** One planned menu item's contribution to the recipe-set hash — the exact `(recipeId, servingsOverride)` pair `generateShoppingList`'s own aggregation step already reads off `MenuItemRow`. */
export interface RecipeSetHashInput {
  recipeId: string;
  servingsOverride: number | null;
}

/**
 * D6's locked cache-key ingredient (`E2E_MVP_PLAN.md` §23.2.6) — a
 * deterministic SHA-256 hex digest, truncated to 16 characters, over the
 * SORTED list of `(recipeId, servingsOverride)` pairs actually planned for
 * a week. Deliberately NOT deduped by `recipeId` (unlike
 * `buildStaplesNoteContext`'s own dedup, `prompts/staplesNote.ts`) — this
 * hash's whole job is to change whenever the PLAN changes, and the plan
 * genuinely differs between "rajma once" and "rajma twice, once at a
 * different `servingsOverride`," even though both produce the same
 * deduped prompt context.
 *
 * Sorting first is what makes this a pure function of the SET of planned
 * pairs, not their insertion order — `findMenuItems`' own `ORDER BY
 * day_of_week, meal_slot, created_at` is a meaningful display order, not a
 * canonical one, and two regenerates that happen to reorder unrelated menu
 * items (without changing which recipes/servings are actually planned)
 * must hash identically. `servingsOverride: null` sorts before any number
 * via the `??` fallback below (a stable, arbitrary total order — this
 * function only needs *a* deterministic order, not a semantically
 * meaningful one).
 *
 * 16 hex characters (64 bits) is D6's own explicit call: "plenty of
 * collision resistance for a cache key, short enough to stay a reasonable
 * DynamoDB `SK`" — this is a cache-key namespacer, not a security boundary,
 * so SHA-256's full 256 bits of output would be needless DynamoDB item-size
 * overhead for no real benefit here.
 */
export const computeRecipeSetHash = (pairs: readonly RecipeSetHashInput[]): string => {
  const sorted = [...pairs].sort((a, b) => {
    if (a.recipeId !== b.recipeId) {
      return a.recipeId < b.recipeId ? -1 : 1;
    }
    return (a.servingsOverride ?? -1) - (b.servingsOverride ?? -1);
  });

  const canonical = JSON.stringify(sorted.map((pair) => [pair.recipeId, pair.servingsOverride]));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
};
