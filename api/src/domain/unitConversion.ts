import { canonicalizePantryUnit } from './pantryUnits.js';

/**
 * `pantryUnits.ts`'s `KNOWN_PANTRY_UNITS` (`g, kg, ml, l, piece, packet,
 * bunch, tsp, tbsp, cup`) splits into two physically inter-convertible
 * families plus a count-only remainder — E2E_MVP_PLAN.md §17.2.3 (D3).
 * `piece`/`packet`/`bunch` deliberately have no entry in either table
 * below: they stay exact-unit-match-only, same as an unrecognised/free-text
 * unit, per the locked design.
 *
 * Keyed by plain `string`, not `KnownPantryUnit` — `canonicalizePantryUnit`
 * itself returns `string` (it deliberately passes an unrecognised unit
 * through unchanged, `pantryUnits.ts`'s own contract), so typing these
 * tables' keys as the narrower `KnownPantryUnit` would force an unsafe
 * cast at every lookup site below to paper over a mismatch that isn't
 * actually there — a `Partial<Record<string, number>>` lookup is exactly
 * as safe (an out-of-table key legitimately yields `undefined`) without
 * lying about the domain of the value being looked up.
 */
const MASS_GRAMS_PER_UNIT: Partial<Record<string, number>> = {
  g: 1,
  kg: 1000,
};

/**
 * US-customary approximations, rounded to 4 significant figures, per
 * §17.2.3's own locked values — `tbsp` = 3 `tsp`, `cup` = 48 `tsp` = 16
 * `tbsp`.
 */
const VOLUME_ML_PER_UNIT: Partial<Record<string, number>> = {
  ml: 1,
  l: 1000,
  tsp: 4.9289,
  tbsp: 14.7868,
  cup: 236.588,
};

/**
 * Converts `quantity` from `fromUnit` to `toUnit` when both canonicalize
 * into the same family (mass or volume), returning `null` otherwise —
 * cross-family, or either unit outside both tables (D3's "small hardcoded
 * conversion table" design). An identical unit (even one unknown to either
 * table, e.g. two `piece`s) always converts trivially to itself, since no
 * lookup is needed to know `n` of a unit equals `n` of the same unit.
 */
export const convertQuantity = (quantity: number, fromUnit: string, toUnit: string): number | null => {
  const from = canonicalizePantryUnit(fromUnit);
  const to = canonicalizePantryUnit(toUnit);

  if (from === to) {
    return quantity;
  }

  const fromGrams = MASS_GRAMS_PER_UNIT[from];
  const toGrams = MASS_GRAMS_PER_UNIT[to];
  if (fromGrams !== undefined && toGrams !== undefined) {
    return (quantity * fromGrams) / toGrams;
  }

  const fromMl = VOLUME_ML_PER_UNIT[from];
  const toMl = VOLUME_ML_PER_UNIT[to];
  if (fromMl !== undefined && toMl !== undefined) {
    return (quantity * fromMl) / toMl;
  }

  return null;
};
