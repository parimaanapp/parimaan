import type { PoolClient } from 'pg';
import { aggregateIngredients, categorize, subtractPantry } from '../domain/shoppingListGeneration.js';
import type { AggregationMenuItem, AggregationRecipe, PantryItemForSubtraction } from '../domain/shoppingListGeneration.js';
import { findMenuItems } from '../repositories/menuRepository.js';
import type { MenuRow } from '../repositories/menuRepository.js';
import { findRecipeIngredientsByRecipeIds } from '../repositories/recipeRepository.js';
import { findPantryItems } from '../repositories/pantryRepository.js';
import { insertShoppingList, insertShoppingListItems } from '../repositories/shoppingListRepository.js';
import type { NewShoppingListItemInput, ShoppingListItemRow, ShoppingListRow } from '../repositories/shoppingListRepository.js';

/**
 * Reads `menu.id`'s current `menu_items` (each hydrated with its
 * `RecipeRow`, via `findMenuItems`) plus every one of those recipes'
 * ingredients (a single batch call, `findRecipeIngredientsByRecipeIds`),
 * and builds S1's `RecipesById` map — `aggregateIngredients`'s own second
 * argument. A recipe with zero own ingredient rows still gets a map entry
 * (with an empty `ingredients` array), so it contributes nothing without
 * `aggregateIngredients` having to special-case a missing map entry for it.
 */
const buildRecipesById = async (
  client: PoolClient,
  menuItems: readonly { recipe: { id: string; servings: number } }[],
): Promise<ReadonlyMap<string, AggregationRecipe>> => {
  const recipeIds = [...new Set(menuItems.map((item) => item.recipe.id))];
  const ingredients = await findRecipeIngredientsByRecipeIds(client, recipeIds);
  const ingredientsByRecipe = new Map<string, AggregationRecipe['ingredients'][number][]>();
  for (const ingredient of ingredients) {
    const existing = ingredientsByRecipe.get(ingredient.recipeId) ?? [];
    existing.push({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      category: ingredient.category,
      isStaple: ingredient.isStaple,
    });
    ingredientsByRecipe.set(ingredient.recipeId, existing);
  }

  return new Map(
    menuItems
      .map((item) => item.recipe)
      .filter((recipe, index, all) => all.findIndex((other) => other.id === recipe.id) === index)
      .map((recipe) => [
        recipe.id,
        { id: recipe.id, servings: recipe.servings, ingredients: ingredientsByRecipe.get(recipe.id) ?? [] },
      ]),
  );
};

/**
 * Runs S1's full pure pipeline (`aggregateIngredients` → `subtractPantry` →
 * `categorize`, `isStapleExcluded` filtering happens INSIDE
 * `aggregateIngredients` itself) against `menu`'s CURRENT `menu_items` and
 * `menu.householdId`'s CURRENT pantry — "current" matters for
 * `regenerateShoppingList`, which re-runs this against live state rather
 * than reusing whatever the prior generation computed (D8). The result is
 * flattened back out of `categorize`'s grouped shape into one ordered flat
 * array (category-then-original-order), which is both what
 * `insertShoppingListItems` needs to write and a stable, defined display
 * order the flat `ShoppingListItem` list itself does not otherwise
 * guarantee (S6's own "categories render in a stable, defined order" RED
 * test, satisfied here at the source rather than left to the client).
 * Returns an empty array for an empty menu — never an error (S1/S2's own
 * "empty menu generates an empty list" invariant), since `aggregateIngredients`
 * of an empty `menuItems` array is itself an empty array.
 */
export const computeFreshShoppingListItems = async (
  client: PoolClient,
  menu: MenuRow,
): Promise<NewShoppingListItemInput[]> => {
  const menuItems = await findMenuItems(client, menu.id);
  const recipesById = await buildRecipesById(client, menuItems);

  const aggregationMenuItems: AggregationMenuItem[] = menuItems.map((item) => ({
    dayOfWeek: item.dayOfWeek,
    mealSlot: item.mealSlot,
    recipeId: item.recipe.id,
    servingsOverride: item.servingsOverride,
  }));

  const pantryRows = await findPantryItems(client, menu.householdId, {});
  const pantryItems: PantryItemForSubtraction[] = pantryRows.map((row) => ({
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
  }));

  const aggregated = aggregateIngredients(aggregationMenuItems, recipesById);
  const subtracted = subtractPantry(aggregated, pantryItems);
  const grouped = categorize(subtracted);

  return grouped.flatMap((group) =>
    group.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      sourceRecipeId: item.sourceRecipeId,
    })),
  );
};

/**
 * Writes a brand-new `shopping_lists` row plus every freshly-computed item
 * for `menu` — the ONE shared write path both `generateShoppingList` and
 * `regenerateShoppingList`'s "no prior list" branch call, so the RED test
 * "`confirmed: true` with no prior list behaves identically to a first
 * `generateShoppingList` call" (E2E_MVP_PLAN.md §17.3 S2) is true by
 * construction rather than by two independently-written code paths
 * happening to agree.
 */
export const createFreshShoppingList = async (
  client: PoolClient,
  menu: MenuRow,
): Promise<{ list: ShoppingListRow; items: ShoppingListItemRow[] }> => {
  const freshItems = await computeFreshShoppingListItems(client, menu);
  const list = await insertShoppingList(client, {
    householdId: menu.householdId,
    generatedFromMenuId: menu.id,
  });
  const items = await insertShoppingListItems(client, list.id, freshItems);
  return { list, items };
};
