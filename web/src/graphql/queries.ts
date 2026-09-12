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
