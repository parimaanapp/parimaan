import type {
  HouseholdRole,
  HouseholdRow,
  MembershipWithHouseholdRow,
  SettingsRow,
  SubscriptionStatus,
} from '../repositories/householdRepository.js';
import type { GraphQLUser } from './user.js';

export interface GraphQLSettings {
  householdId: string;
  mealsEnabled: readonly string[];
  /** AWSJSON scalar — AppSync serializes this as a JSON *string*, not a nested object. */
  mealStructure: string;
  cuisineTier1: readonly string[];
  /** AWSJSON scalar — see mealStructure. */
  cuisineTier2Weights: string;
  dietaryTags: readonly string[];
  allergens: readonly string[];
  skipIngredients: readonly string[];
}

export const toGraphQLSettings = (row: SettingsRow): GraphQLSettings => ({
  householdId: row.householdId,
  mealsEnabled: row.mealsEnabled,
  mealStructure: JSON.stringify(row.mealStructure),
  cuisineTier1: row.cuisineTier1,
  cuisineTier2Weights: JSON.stringify(row.cuisineTier2Weights),
  dietaryTags: row.dietaryTags,
  allergens: row.allergens,
  skipIngredients: row.skipIngredients,
});

export interface GraphQLMembership {
  id: string;
  household: GraphQLHousehold;
  user: GraphQLUser;
  role: HouseholdRole;
  joinedAt: string;
}

export interface GraphQLHousehold {
  id: string;
  name: string;
  inviteCode: string;
  primaryUserId: string;
  members: GraphQLMembership[];
  settings: GraphQLSettings;
  subscriptionStatus: SubscriptionStatus;
}

/**
 * Maps a `households` row, its already-mapped `GraphQLMembership[]` members,
 * and its settings row to the GraphQL `Household` shape. Members are taken
 * pre-mapped (rather than raw rows) because mapping a membership requires
 * its `User` — which this repository slice only ever has for the caller
 * themself, so the caller builds each `GraphQLMembership` via
 * `toGraphQLMembership` first. `subscriptionStatus` (and `role`, in
 * `toGraphQLMembership` below) are passed through byte-for-byte — these are
 * `TEXT` columns constrained to match this repo's GraphQL enum value names
 * exactly (e.g. `past_due`), and "helpfully" reformatting them (casing,
 * word-splitting) would silently break that contract.
 */
export const toGraphQLHousehold = (
  household: HouseholdRow,
  members: readonly GraphQLMembership[],
  settings: SettingsRow,
): GraphQLHousehold => ({
  id: household.id,
  name: household.name,
  inviteCode: household.inviteCode,
  primaryUserId: household.primaryUserId,
  members: [...members],
  settings: toGraphQLSettings(settings),
  subscriptionStatus: household.subscriptionStatus,
});

/**
 * Maps a joined membership row (plus the already-mapped `GraphQLUser` it
 * belongs to) to the GraphQL `HouseholdMembership` shape. `household` is
 * mapped with an empty `members` list (rather than recursing into every
 * co-member's own membership list) — this repository slice never needs a
 * membership's household to itself list all members; doing so would be an
 * unbounded expansion for no consumer in this schema version.
 */
export const toGraphQLMembership = (
  row: MembershipWithHouseholdRow,
  user: GraphQLUser,
): GraphQLMembership => ({
  id: row.id,
  household: toGraphQLHousehold(row.household, [], row.settings),
  user,
  role: row.role,
  joinedAt: row.joinedAt.toISOString(),
});
