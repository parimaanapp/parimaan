/** Units bought as whole things; their amounts are shown in half steps. */
const COUNT_LIKE_UNITS: ReadonlySet<string> = new Set([
  'piece',
  'bunch',
  'dozen',
  'slice',
  'pack',
  'packet',
  'loaf',
  'bottle',
  'jar',
]);

/** Quantities are cleaned to this many decimals first, so float noise from summing never counts as a "decimal". */
const NOISE_DECIMALS = 6;
const DISPLAY_DECIMALS = 2;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Rounds an aggregated shopping quantity for display and storage (unit
 * conversions leave amounts like 7.28 bunch).
 *
 * - Count-like units (piece, bunch, ...): rounded UP to the next 0.5, so the
 *   list never asks for less than the recipes need. A converted 7.28 bunch
 *   reads as 7.5; whole and half amounts are untouched.
 * - Everything else (g, kg, ml, l, cup, ...): at most 2 decimals.
 */
export const roundShoppingQuantity = (quantity: number | null, unit: string | null): number | null => {
  if (quantity === null) {
    return null;
  }
  const cleaned = roundTo(quantity, NOISE_DECIMALS);
  if (unit !== null && COUNT_LIKE_UNITS.has(unit.trim().toLowerCase())) {
    return Math.ceil(cleaned * 2) / 2;
  }
  return roundTo(cleaned, DISPLAY_DECIMALS);
};
