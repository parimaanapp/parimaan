/**
 * `pantry_items.category` is a free-text, nullable `TEXT` column, not a
 * closed enum (E2E_MVP_PLAN.md §11.2.4, Option C) — see `pantryUnits.ts`'s
 * identical reasoning. Starting set is a guess from `PRD.md` §7.1.
 */
export const KNOWN_PANTRY_CATEGORIES = [
  'dal',
  'spice',
  'dairy',
  'produce',
  'dry_goods',
  'grain',
  'oil',
  'condiment',
  'frozen',
  'other',
] as const;

export type KnownPantryCategory = (typeof KNOWN_PANTRY_CATEGORIES)[number];

/**
 * Normalises a category against the known set (trim + case-insensitive
 * match), passing an unrecognised value through unchanged (trimmed) rather
 * than rejecting it. See `canonicalizePantryUnit` for the identical
 * reasoning.
 */
export const canonicalizePantryCategory = (rawCategory: string): string => {
  const trimmed = rawCategory.trim();
  const lower = trimmed.toLowerCase();
  const known = KNOWN_PANTRY_CATEGORIES.find((category) => category === lower);
  return known ?? trimmed;
};
