/**
 * Display form of a quantity: at most two decimals, trailing zeros dropped,
 * so `0.3333333333333333` reads `0.33` and `2.0` reads `2`. Display only —
 * stored quantities are never rounded. Mirrors the mobile app's
 * `formatQuantity` (`mobile/lib/shared/format/quantity_format.dart`).
 */
export function formatQuantity(quantity: number): string {
  const rounded = Number(quantity.toFixed(2));
  // `-0` and tiny values both read as a plain `0`.
  return rounded === 0 ? '0' : String(rounded);
}
