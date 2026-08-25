/**
 * `pantry_items.unit` is a free-text `TEXT` column, not a closed enum
 * (E2E_MVP_PLAN.md §11.2.4, Option C) — this is the canonicalisation layer
 * that keeps "kg", "Kg", and " kg " from being treated as three different
 * units downstream (W12's pantry-deduction matching) while still accepting
 * a unit no one has thought of yet. Starting set is a guess from
 * `PRD.md` §7.1, not a locked taxonomy — it's meant to grow via edits here,
 * never a migration.
 */
export const KNOWN_PANTRY_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'packet',
  'bunch',
  'tsp',
  'tbsp',
  'cup',
] as const;

export type KnownPantryUnit = (typeof KNOWN_PANTRY_UNITS)[number];

/**
 * Normalises a unit against the known set (trim + case-insensitive match),
 * passing an unrecognised value through unchanged (trimmed) rather than
 * rejecting it — the column stays open on purpose, so a user typing "पाव"
 * is never bounced.
 */
export const canonicalizePantryUnit = (rawUnit: string): string => {
  const trimmed = rawUnit.trim();
  const lower = trimmed.toLowerCase();
  const known = KNOWN_PANTRY_UNITS.find((unit) => unit === lower);
  return known ?? trimmed;
};
