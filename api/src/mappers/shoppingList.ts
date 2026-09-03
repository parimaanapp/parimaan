import { randomUUID } from 'node:crypto';
import type { ShoppingListItemRow, ShoppingListRow } from '../repositories/shoppingListRepository.js';
import type { NewShoppingListItemInput } from '../repositories/shoppingListRepository.js';

export interface GraphQLShoppingListItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  sourceRecipeId: string | null;
  purchased: boolean;
  purchasedBy: string | null;
  purchasedAt: string | null;
  movedToPantry: boolean;
}

export const toGraphQLShoppingListItem = (row: ShoppingListItemRow): GraphQLShoppingListItem => ({
  id: row.id,
  name: row.name,
  quantity: row.quantity,
  unit: row.unit,
  category: row.category,
  sourceRecipeId: row.sourceRecipeId,
  purchased: row.purchased,
  purchasedBy: row.purchasedBy,
  purchasedAt: row.purchasedAt === null ? null : row.purchasedAt.toISOString(),
  movedToPantry: row.movedToPantry,
});

export interface GraphQLShoppingList {
  id: string;
  householdId: string;
  generatedFromMenuId: string | null;
  createdAt: string;
  closedAt: string | null;
  aiStaplesNote: string | null;
  items: readonly GraphQLShoppingListItem[];
}

export const toGraphQLShoppingList = (
  row: ShoppingListRow,
  items: readonly ShoppingListItemRow[],
): GraphQLShoppingList => ({
  id: row.id,
  householdId: row.householdId,
  generatedFromMenuId: row.generatedFromMenuId,
  createdAt: row.createdAt.toISOString(),
  closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
  aiStaplesNote: row.aiStaplesNote,
  items: items.map(toGraphQLShoppingListItem),
});

/**
 * Builds an UNPERSISTED `GraphQLShoppingListItem` for D8's
 * `regenerateShoppingList(confirmed: false)` preview (E2E_MVP_PLAN.md
 * §17.2.8) — the item this line WOULD become if the caller re-called with
 * `confirmed: true`, but with no real database row backing it yet. `id` is
 * a fresh, never-persisted `randomUUID()` purely so the response satisfies
 * `ShoppingListItem.id: ID!`; a client must never attempt a mutation (e.g.
 * a future `haveIt`) against this id — the confirm-dialog UI this exists
 * for only ever reads `items.length`/`category` off the preview to render
 * real counts, never acts on individual item ids from it.
 */
export const toEphemeralGraphQLShoppingListItem = (item: NewShoppingListItemInput): GraphQLShoppingListItem => ({
  id: randomUUID(),
  name: item.name,
  quantity: item.quantity,
  unit: item.unit,
  category: item.category,
  sourceRecipeId: item.sourceRecipeId,
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
});

/**
 * Builds an UNPERSISTED `GraphQLShoppingList` for `regenerateShoppingList(confirmed: false)`
 * when NO prior open list exists for this menu — the same shape a
 * subsequent `confirmed: true` call (or a first `generateShoppingList`
 * call) would actually write, but nothing here is inserted. `id`/
 * `createdAt` are fresh/now, never persisted — same "never act on this id"
 * caveat as {@link toEphemeralGraphQLShoppingListItem}.
 */
export const buildEphemeralNewShoppingListPreview = (
  householdId: string,
  menuId: string,
  freshAutoItems: readonly NewShoppingListItemInput[],
): GraphQLShoppingList => ({
  id: randomUUID(),
  householdId,
  generatedFromMenuId: menuId,
  createdAt: new Date().toISOString(),
  closedAt: null,
  aiStaplesNote: null,
  items: freshAutoItems.map(toEphemeralGraphQLShoppingListItem),
});

/**
 * Builds an UNPERSISTED `GraphQLShoppingList` for `regenerateShoppingList(confirmed: false)`
 * when an open list ALREADY exists for this menu (D8's merge-regenerate
 * preview) — the real, existing list's own id/metadata plus its real,
 * unchanged preserved items, concatenated with the freshly-recomputed
 * auto-generated portion as ephemeral (not-yet-written) items. A client
 * diffs this against the currently-displayed list to render real "N items
 * kept, M recomputed" confirm-dialog copy (E2E_MVP_PLAN.md §17.2.8) —
 * nothing here is written until a subsequent `confirmed: true` call.
 */
export const buildEphemeralMergePreview = (
  existingList: ShoppingListRow,
  preservedItems: readonly ShoppingListItemRow[],
  freshAutoItems: readonly NewShoppingListItemInput[],
): GraphQLShoppingList => ({
  id: existingList.id,
  householdId: existingList.householdId,
  generatedFromMenuId: existingList.generatedFromMenuId,
  createdAt: existingList.createdAt.toISOString(),
  closedAt: existingList.closedAt === null ? null : existingList.closedAt.toISOString(),
  aiStaplesNote: existingList.aiStaplesNote,
  items: [...preservedItems.map(toGraphQLShoppingListItem), ...freshAutoItems.map(toEphemeralGraphQLShoppingListItem)],
});
