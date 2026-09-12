import 'server-only';
import type { Client, CombinedError } from 'urql';
import { currentWeekStartDateIso } from '@/domain/currentWeek';
import {
  MENU_QUERY,
  PANTRY_QUERY,
  SHOPPING_LIST_QUERY,
  type MenuQueryResult,
  type PantryQueryResult,
  type ShoppingListQueryResult,
} from '@/graphql/queries';

export interface DashboardData {
  pantry: PantryQueryResult['pantry'];
  menu: MenuQueryResult['menu'];
  shoppingList: ShoppingListQueryResult['shoppingList'];
}

const throwIfError = (error: CombinedError | undefined): void => {
  if (error) {
    throw error;
  }
};

const fetchPantry = async (client: Client, householdId: string): Promise<PantryQueryResult['pantry']> => {
  const result = await client.query<PantryQueryResult>(PANTRY_QUERY, { householdId }).toPromise();
  throwIfError(result.error);
  return result.data?.pantry ?? [];
};

const fetchMenu = async (
  client: Client,
  householdId: string,
  weekStartDate: string,
): Promise<MenuQueryResult['menu']> => {
  const result = await client.query<MenuQueryResult>(MENU_QUERY, { householdId, weekStartDate }).toPromise();
  throwIfError(result.error);
  return result.data?.menu ?? null;
};

/**
 * The shopping list is only meaningful once a menu exists for the week
 * (D4: it is keyed by `menuId`, not `householdId`) — `menuId: null` means
 * no menu exists yet, and this returns `null` WITHOUT ever issuing the
 * query, the honest "no list yet because there's no menu yet" case rather
 * than querying with an unavailable id.
 */
const fetchShoppingList = async (
  client: Client,
  menuId: string | null,
): Promise<ShoppingListQueryResult['shoppingList']> => {
  if (menuId === null) {
    return null;
  }
  const result = await client.query<ShoppingListQueryResult>(SHOPPING_LIST_QUERY, { menuId }).toPromise();
  throwIfError(result.error);
  return result.data?.shoppingList ?? null;
};

/**
 * Loads the dashboard's three independent sections (D5: `Query.pantry`,
 * `Query.menu`, D4's `Query.shoppingList`) for `householdId` — always that
 * RESOLVED household's own id (D3's `resolvePrimaryHouseholdId`), never a
 * client-suppliable one, since this function takes no caller input beyond
 * the already-authenticated `client` and the already-resolved
 * `householdId`. Pantry and menu are independent reads and run in
 * parallel; the shopping list is fetched afterward, since it depends on
 * the menu's own id.
 */
export const loadDashboardData = async (
  client: Client,
  householdId: string,
  today: Date = new Date(),
): Promise<DashboardData> => {
  const weekStartDate = currentWeekStartDateIso(today);

  const [pantry, menu] = await Promise.all([
    fetchPantry(client, householdId),
    fetchMenu(client, householdId, weekStartDate),
  ]);

  const shoppingList = await fetchShoppingList(client, menu?.id ?? null);

  return { pantry, menu, shoppingList };
};
