/**
 * Application-level mirrors of `household_settings`'s DDL column defaults
 * (see `api/migrations/1787072268736_baseline-schema.ts`). Kept here, not
 * re-derived from the DB on every insert, so `createHousehold`'s resolver
 * can build the row it returns to the client without a round-trip SELECT —
 * and so a future settings-shape change is a one-file diff reviewed
 * alongside the migration that changes the DDL default.
 *
 * `Object.freeze` guards the "immutability" coding-style rule: these are
 * shared, module-scope constants — a caller mutating one in place would
 * corrupt every subsequent caller's defaults.
 */
export const DEFAULT_MEALS_ENABLED = Object.freeze(['breakfast', 'lunch', 'dinner'] as const);

export interface MealStructureEntry {
  carb: number;
  sabzi_dal: number;
  accompaniment: number;
}

export type MealStructure = Readonly<Record<'lunch' | 'dinner', Readonly<MealStructureEntry>>>;

export const DEFAULT_MEAL_STRUCTURE: MealStructure = Object.freeze({
  lunch: Object.freeze({ carb: 1, sabzi_dal: 2, accompaniment: 1 }),
  dinner: Object.freeze({ carb: 1, sabzi_dal: 2, accompaniment: 1 }),
});

export const DEFAULT_CUISINE_TIER1 = Object.freeze(['north_indian'] as const);

export const DEFAULT_CUISINE_TIER2_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({});

export const DEFAULT_DIETARY_TAGS: readonly string[] = Object.freeze([]);

export const DEFAULT_ALLERGENS: readonly string[] = Object.freeze([]);

export const DEFAULT_SKIP_INGREDIENTS: readonly string[] = Object.freeze([]);
