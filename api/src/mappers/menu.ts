import type { MealConfigSnapshot, MenuItemRow, MenuRow } from '../repositories/menuRepository.js';
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
  /**
   * `AWSJSON!` (W14 S2, D1/D4, E2E_MVP_PLAN.md §20.2.1/§20.2.4) — the
   * household's `mealsEnabled`/`mealStructure` frozen at this menu's
   * creation time, never updated after insert. Passed through byte-for-byte
   * like `GraphQLSettings.mealStructure` (`mappers/household.ts`'s own
   * comment on why: this is a Direct Lambda Resolver, and AppSync applies
   * its own AWSJSON serialization to whatever the resolver returns — a
   * manual re-stringify here would double-encode the wire value).
   */
  mealConfigSnapshot: MealConfigSnapshot;
  items: readonly GraphQLMenuItem[];
}

export const toGraphQLMenu = (row: MenuRow, items: readonly MenuItemRow[]): GraphQLMenu => ({
  id: row.id,
  householdId: row.householdId,
  weekStartDate: `${row.weekStartDate}T00:00:00.000Z`,
  mealConfigSnapshot: row.mealConfigSnapshot,
  items: items.map(toGraphQLMenuItem),
});

/** W10 (§16.2.1, D3/D5) — the auto-fill dry-run/commit pair's shared shapes. */
export interface GraphQLUnfilledSlot {
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
}

/** One proposal `Query.autoFillPreview` makes for one empty slot — NOT yet written to `menu_items`. */
export interface GraphQLProposedMenuItem {
  recipeId: string;
  recipe: GraphQLRecipe;
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
}

export interface GraphQLAutoFillPreviewResult {
  items: readonly GraphQLProposedMenuItem[];
  filledCount: number;
  unfilledSlots: readonly GraphQLUnfilledSlot[];
}

export interface GraphQLAutoFillResult {
  menu: GraphQLMenu;
  filledCount: number;
  unfilledSlots: readonly GraphQLUnfilledSlot[];
}

/**
 * W14 S8 (E2E_MVP_PLAN.md §20.2.8, D8) — `clearMenuDay`/`clearMenuWeek`'s
 * shared return shape. `clearedCount`/`preservedCount` are always reported
 * together, matching `AutoFillResult`'s own "never a silent partial result"
 * posture: a household always sees both how much was cleared AND how much
 * survived (because it was cooked), never just one number.
 */
export interface GraphQLClearMenuResult {
  clearedCount: number;
  preservedCount: number;
}

/**
 * W14 S8 (E2E_MVP_PLAN.md §20.2.8, D8) — `copyMenuDay`/`copyMenuWeek`'s
 * shared return shape. `menu` is the TARGET menu (post-copy) — for
 * `copyMenuDay` that's the same `menuId` the caller passed in; for
 * `copyMenuWeek` it's the (possibly freshly get-or-created) target week's
 * own menu, carrying its OWN independent `mealConfigSnapshot`.
 */
export interface GraphQLCopyMenuResult {
  menu: GraphQLMenu;
  copiedCount: number;
  skippedCount: number;
}
