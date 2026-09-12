/**
 * W18 D3's household-resolution query: `me.households[0]` is the resolved,
 * active household for a whole session (no switcher this week). `Query.me`
 * itself deliberately omits `households` (see `queries.ts`'s own doc
 * comment on `ME_QUERY`), so this is a second, separate request selecting
 * `User.households` — the field resolver that exists specifically to
 * surface it (`api/src/resolvers/userHouseholds.ts`).
 */
export const MY_HOUSEHOLDS_QUERY = `
  query MyHouseholds {
    me {
      id
      households {
        household {
          id
          name
        }
      }
    }
  }
`;

export interface MyHouseholdsQueryResult {
  me: {
    id: string;
    households: Array<{
      household: {
        id: string;
        name: string;
      };
    }>;
  };
}
