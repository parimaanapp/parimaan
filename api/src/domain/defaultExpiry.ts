import { KNOWN_PANTRY_CATEGORIES, canonicalizePantryCategory } from './pantryCategories.js';
import type { KnownPantryCategory } from './pantryCategories.js';

/**
 * O3 (E2E_MVP_PLAN.md §18.7, §18.3 S1) — sourced from `pantryCategories.ts`'s
 * real `KNOWN_PANTRY_CATEGORIES` enum, not a PRD guess: all ten known
 * categories are covered, none invented, none dropped. `other` has no
 * default (`null`), matching `pantryUnits.ts`/`pantryCategories.ts`'s own
 * "pass unrecognized values through, never invent data for them" posture.
 */
export const DEFAULT_EXPIRY_DAYS_BY_CATEGORY: Readonly<Record<KnownPantryCategory, number | null>> = {
  dal: 180,
  spice: 365,
  dairy: 5,
  produce: 7,
  dry_goods: 270,
  grain: 180,
  oil: 180,
  condiment: 180,
  frozen: 90,
  other: null,
};

/**
 * `markPurchased`'s (S3) default-expiry lookup for a fresh pantry-row
 * insert. `category` is normalized the same way `canonicalizePantryCategory`
 * already normalizes `pantry_items.category` elsewhere (trim +
 * case-insensitive match against the known set) before the table lookup, so
 * `"Dairy"`/`" dairy "` resolve identically to `"dairy"`. A category outside
 * the known set (including `other` itself) returns `null` — no default is
 * invented for data this module doesn't recognize.
 */
export const defaultExpiryDaysForCategory = (category: string): number | null => {
  const canonical = canonicalizePantryCategory(category);
  const known = (KNOWN_PANTRY_CATEGORIES as readonly string[]).includes(canonical);
  return known ? DEFAULT_EXPIRY_DAYS_BY_CATEGORY[canonical as KnownPantryCategory] : null;
};
