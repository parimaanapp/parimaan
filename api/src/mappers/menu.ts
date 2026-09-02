import type { MenuItemRow, MenuRow } from '../repositories/menuRepository.js';
import type { GraphQLRecipe } from './recipe.js';
import { toGraphQLRecipe } from './recipe.js';

export interface GraphQLMenuItem {
  id: string;
  menuId: string;
  recipe: GraphQLRecipe;
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
  servingsOverride: number | null;
  madeAt: string | null;
}

export const toGraphQLMenuItem = (row: MenuItemRow): GraphQLMenuItem => ({
  id: row.id,
  menuId: row.menuId,
  recipe: toGraphQLRecipe(row.recipe),
  dayOfWeek: row.dayOfWeek,
  mealSlot: row.mealSlot,
  slotRole: row.slotRole,
  servingsOverride: row.servingsOverride,
  madeAt: row.madeAt === null ? null : row.madeAt.toISOString(),
});

export interface GraphQLMenu {
  id: string;
  householdId: string;
  /**
   * `AWSDateTime`, per `shared/schema.graphql`'s locked `Menu.weekStartDate`
   * type — the underlying `menus.week_start_date` column is a plain `DATE`
   * (E2E_MVP_PLAN.md §15.2.4: "today"/week boundaries are calendar dates,
   * deliberately not timezone-attached instants). Rendered here as
   * midnight UTC on that date, matching how `MenuRow.weekStartDate`
   * (`YYYY-MM-DD`) round-trips through `AWSDateTime`'s `YYYY-MM-DDThh:mm:ss.sssZ`
   * shape.
   */
  weekStartDate: string;
  items: readonly GraphQLMenuItem[];
}

export const toGraphQLMenu = (row: MenuRow, items: readonly MenuItemRow[]): GraphQLMenu => ({
  id: row.id,
  householdId: row.householdId,
  weekStartDate: `${row.weekStartDate}T00:00:00.000Z`,
  items: items.map(toGraphQLMenuItem),
});
