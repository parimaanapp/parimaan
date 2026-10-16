import { canonicalizePantryUnit } from './pantryUnits.js';
import { convertQuantity } from './unitConversion.js';
import type { CatalogEntry } from './ingredientCatalog.js';

/** One `unit_conversions` row: 1 `unit` = `amount` `baseUnit` (ingredient scope key = ingredient id, subcategory scope key = subcategory). */
export interface UnitConversionRow {
  readonly scope: 'subcategory' | 'ingredient';
  readonly key: string;
  readonly unit: string;
  readonly baseUnit: string;
  readonly amount: number;
}

export interface UnitFactor {
  readonly baseUnit: string;
  readonly amount: number;
}

export interface ConversionLookup {
  /** The catalog's factor for `unit` of this ingredient: ingredient scope first, then its subcategory. `null` = not defined. */
  readonly factorFor: (ingredientId: string | null, unit: string) => UnitFactor | null;
}

/**
 * Converts `quantity` of an ingredient between units. `null` means "no
 * defined conversion": callers must keep the units apart rather than guess.
 */
export type UnitConverter = (
  ingredientId: string | null,
  quantity: number,
  fromUnit: string,
  toUnit: string,
) => number | null;

/** Physical families only (mass, volume, count); no catalog data. */
export const defaultUnitConverter: UnitConverter = (_ingredientId, quantity, fromUnit, toUnit) =>
  convertQuantity(quantity, fromUnit, toUnit);

const scoped = (scope: string, key: string, unit: string): string => `${scope}\u0000${key}\u0000${unit}`;

export const createConversionLookup = (
  entries: readonly CatalogEntry[],
  rows: readonly UnitConversionRow[],
): ConversionLookup => {
  const subcategoryOf = new Map(entries.map((entry) => [entry.id, entry.subcategory]));
  const factors = new Map<string, UnitFactor>();
  for (const row of rows) {
    factors.set(scoped(row.scope, row.key, row.unit), { baseUnit: row.baseUnit, amount: row.amount });
  }
  return {
    factorFor: (ingredientId, unit) => {
      if (ingredientId === null) {
        return null;
      }
      const canonical = canonicalizePantryUnit(unit);
      const own = factors.get(scoped('ingredient', ingredientId, canonical));
      if (own !== undefined) {
        return own;
      }
      const subcategory = subcategoryOf.get(ingredientId);
      return subcategory === undefined ? null : (factors.get(scoped('subcategory', subcategory, canonical)) ?? null);
    },
  };
};

const toBase = (factor: UnitFactor | null, quantity: number, unit: string): { value: number; unit: string } =>
  factor === null
    ? { value: quantity, unit: canonicalizePantryUnit(unit) }
    : { value: quantity * factor.amount, unit: factor.baseUnit };

const viaCatalog = (
  lookup: ConversionLookup,
  ingredientId: string,
  quantity: number,
  fromUnit: string,
  toUnit: string,
): number | null => {
  const from = lookup.factorFor(ingredientId, fromUnit);
  const to = lookup.factorFor(ingredientId, toUnit);
  if (from === null && to === null) {
    return null;
  }
  const source = toBase(from, quantity, fromUnit);
  const targetBase = to === null ? canonicalizePantryUnit(toUnit) : to.baseUnit;
  const inTargetBase =
    source.unit === targetBase ? source.value : convertQuantity(source.value, source.unit, targetBase);
  if (inTargetBase === null) {
    return null;
  }
  return to === null ? inTargetBase : inTargetBase / to.amount;
};

/**
 * Physical conversion first (g/kg, ml/l/tsp/tbsp/cup, piece/dozen), then the
 * catalog factors: both units are taken to their base unit (a unit with no
 * factor is treated as a base unit itself), bridged by the physical table
 * when the two bases differ. Anything else is `null`.
 */
export const createUnitConverter =
  (lookup: ConversionLookup): UnitConverter =>
  (ingredientId, quantity, fromUnit, toUnit) => {
    const direct = convertQuantity(quantity, fromUnit, toUnit);
    if (direct !== null || ingredientId === null) {
      return direct;
    }
    return viaCatalog(lookup, ingredientId, quantity, fromUnit, toUnit);
  };
