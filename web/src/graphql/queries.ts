/**
 * W18 S3's one proof-of-life query — `Query.me`, per the plan's own "a
 * single authenticated GraphQL call (e.g. `Query.me`) succeeds, nothing
 * more." Field selection matches `shared/schema.graphql`'s `User` type
 * exactly (no `households` — that's a separate resolver field per
 * `Query.me`'s own doc comment, not needed for this slice).
 */
export const ME_QUERY = `
  query Me {
    me {
      id
      email
      displayName
      avatarUrl
    }
  }
`;

export interface MeQueryResult {
  me: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

/**
 * W18 S4's household-resolution query (D3, §24.2.3): resolves the caller's
 * first household membership — `me.households[0]` — as the active
 * household for the whole dashboard session, with no switcher. Field
 * selection matches `User.households`/`HouseholdMembership.household`
 * exactly (`shared/schema.graphql`); only `id` is selected on `Household`
 * since that's all the dashboard's own three section queries need as their
 * `householdId` argument.
 */
export const MY_HOUSEHOLDS_QUERY = `
  query MyHouseholds {
    me {
      households {
        household {
          id
        }
      }
    }
  }
`;

export interface MyHouseholdsQueryResult {
  me: {
    households: Array<{
      household: {
        id: string;
      };
    }>;
  };
}

/**
 * D5's read-only Pantry section: `Query.pantry` for the resolved household,
 * with no `search`/`category` filter — the dashboard renders every item,
 * grouped client-side by `domain/pantryGrouping.ts`'s own stable category
 * order, not a server-side-filtered subset.
 */
export const PANTRY_QUERY = `
  query Pantry($householdId: ID!) {
    pantry(householdId: $householdId) {
      id
      name
      quantity
      unit
      category
      isStaple
      expiryDate
    }
  }
`;

export interface PantryQueryResult {
  pantry: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    category: string | null;
    isStaple: boolean;
    expiryDate: string | null;
  }>;
}

/**
 * D5's read-only "This week's plan" section: `Query.menu` for the resolved
 * household and the current week (`domain/currentWeek.ts`'s own
 * `currentWeekStartDateIso`, mirroring mobile's identical computation).
 * Returns `null` — the section's own honest empty state, not an error —
 * when no menu exists yet for this week (`menu.ts`'s own documented
 * behavior).
 */
export const MENU_QUERY = `
  query Menu($householdId: ID!, $weekStartDate: AWSDateTime!) {
    menu(householdId: $householdId, weekStartDate: $weekStartDate) {
      id
      weekStartDate
      items {
        id
        dayOfWeek
        mealSlot
        slotRole
        recipe {
          id
          title
        }
      }
    }
  }
`;

export interface MenuQueryResult {
  menu: {
    id: string;
    weekStartDate: string;
    items: Array<{
      id: string;
      dayOfWeek: number;
      mealSlot: string;
      slotRole: string;
      recipe: {
        id: string;
        title: string;
      };
    }>;
  } | null;
}

/**
 * D4's new read query (§24.2.4): the dashboard's own "read a shopping list
 * without triggering `generateShoppingList`'s `CONFLICT`-on-exists
 * behavior" need. Returns `null` — the section's own honest empty state —
 * before a list has ever been generated for this week's menu.
 */
export const SHOPPING_LIST_QUERY = `
  query ShoppingList($menuId: ID!) {
    shoppingList(menuId: $menuId) {
      id
      items {
        id
        name
        quantity
        unit
        category
        purchased
      }
    }
  }
`;

export interface ShoppingListQueryResult {
  shoppingList: {
    id: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
      purchased: boolean;
    }>;
  } | null;
}
