import type { UserRow } from '../repositories/userRepository.js';

export interface GraphQLUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Maps a `users` row to the GraphQL `User` shape. Deliberately omits
 * `households` — that field is resolved separately by
 * `resolvers/userHouseholds.ts`, per the settled design breaking the
 * User↔HouseholdMembership↔User cycle.
 */
export const toGraphQLUser = (row: UserRow): GraphQLUser => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
});
