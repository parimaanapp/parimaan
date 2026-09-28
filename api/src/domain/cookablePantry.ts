import { MAX_PROMPT_PANTRY_ITEMS } from './cookPromptText.js';
import { STAPLE_CATEGORIES } from './shoppingListGeneration.js';
import type { PantryItemRef } from './pantryGrounding.js';

/**
 * W21 D6 — what "a pantry too small to cook from" means, and which pantry
 * rows are worth sending to the model. The server enforces the rule; S4/S5
 * add a client twin (`mobile/lib/features/cook/domain/cookable_pantry.dart`,
 * with tests over the same cases) so the state shows instantly and offline.
 */
export const MIN_COOKABLE_PANTRY_ITEMS = 3;

/**
 * Five spices cannot make a meal: the staple categories the prompt cut also drops
 * first (spice, masala, salt, oil), plus condiments, do not count toward the minimum.
 */
const NON_MEAL_CATEGORIES: ReadonlySet<string> = new Set([...STAPLE_CATEGORIES, 'condiment']);

export interface CookablePantryItem {
  readonly name: string;
  readonly category: string | null;
  readonly quantity: number;
}

const categoryOf = (item: { category: string | null }): string => item.category?.trim().toLowerCase() ?? '';

/** An item that has run out is not "in the pantry", so it counts toward nothing and is never offered to the model. */
const inStock = (items: readonly CookablePantryItem[]): CookablePantryItem[] => items.filter((item) => item.quantity > 0);

/** Duplicate rows of one item ("Onion", "onion") are one item. */
export const isPantryTooSmall = (items: readonly CookablePantryItem[]): boolean =>
  new Set(inStock(items).filter((item) => !NON_MEAL_CATEGORIES.has(categoryOf(item))).map((item) => item.name.trim().toLowerCase())).size < MIN_COOKABLE_PANTRY_ITEMS;

const byName = (a: PantryItemRef, b: PantryItemRef): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The rows the prompt is built from and grounding is later computed against
 * (the same list for both, so "in pantry" is exactly what the model was told).
 * Name and category only: quantities are deliberately dropped, so using up
 * one potato does not change the prompt or its cache key. Over the prompt cap,
 * staple categories go first, alphabetically last; food is only cut when food
 * alone is over the cap. Sorted by name so the result is order-independent.
 */
export const selectPromptPantryItems = (items: readonly CookablePantryItem[]): PantryItemRef[] => {
  const refs = inStock(items).map((item): PantryItemRef => ({ name: item.name, category: item.category }));
  if (refs.length <= MAX_PROMPT_PANTRY_ITEMS) {
    return refs.sort(byName);
  }
  const food = refs.filter((ref) => !STAPLE_CATEGORIES.has(categoryOf(ref))).sort(byName);
  const staples = refs.filter((ref) => STAPLE_CATEGORIES.has(categoryOf(ref))).sort(byName);
  return [...food, ...staples.slice(0, Math.max(0, MAX_PROMPT_PANTRY_ITEMS - food.length))].slice(0, MAX_PROMPT_PANTRY_ITEMS).sort(byName);
};
