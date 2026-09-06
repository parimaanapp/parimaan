import type {
  HouseholdRole,
  HouseholdRow,
  MembershipWithHouseholdRow,
  MembershipWithUserRow,
  SettingsRow,
  SubscriptionStatus,
} from '../repositories/householdRepository.js';
import { toGraphQLUser } from './user.js';
import type { GraphQLUser } from './user.js';

export interface GraphQLSettings {
  householdId: string;
  mealsEnabled: readonly string[];
  /**
   * AWSJSON scalar. The resolver hands AppSync the parsed object, not a
   * pre-stringified string — AppSync's own AWSJSON scalar serializer is what
   * turns this into the wire's JSON-string representation, exactly once.
   *
   * A manual `JSON.stringify` here used to precede this (this codebase's own
   * `build.yaml` comment on the mobile side even documented "the wire value
   * really is a string" as the *reason* to map AWSJSON to Dart `String`).
   * That was wrong: this is a Direct Lambda Resolver, and AppSync applies its
   * own AWSJSON serialization to whatever the resolver returns regardless —
   * handing it an *already*-stringified string made AppSync serialize that
   * string too, double-encoding the wire value. A client's single `jsonDecode`
   * then produced the intermediate string back, not a map — silently
   * treating every `mealStructure`-typed lunch/dinner slot as absent
   * (`plannedSlotsForDay`'s "malformed input fails closed to zero slots" path
   * firing on data that was never actually malformed). Only a real signed-in
   * client hitting the genuine AppSync endpoint surfaces this; the direct
   * Lambda invokes this codebase's own real-AWS verification passes have
   * used throughout bypass AppSync's scalar layer entirely and could not
   * have caught it.
   */
  mealStructure: Record<string, unknown>;
  cuisineTier1: readonly string[];
  /** AWSJSON scalar — see mealStructure. */
  cuisineTier2Weights: Record<string, unknown>;
  dietaryTags: readonly string[];
  allergens: readonly string[];
  skipIngredients: readonly string[];
}

export const toGraphQLSettings = (row: SettingsRow): GraphQLSettings => ({
  householdId: row.householdId,
  mealsEnabled: row.mealsEnabled,
  mealStructure: row.mealStructure,
  cuisineTier1: row.cuisineTier1,
  cuisineTier2Weights: row.cuisineTier2Weights,
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

/**
 * Maps a `findMembersForHousehold` join row (which already carries its own
 * `User`) to the GraphQL `HouseholdMembership` shape, given the single
 * `household`/`settings` every member in that list shares — the "wrong
 * shape" `toGraphQLMembership` above is documented against: that one takes
 * an already-mapped `GraphQLUser` for a single (the caller's) membership,
 * not N members each with their own row. Same empty-`members` recursion
 * cutoff as `toGraphQLMembership`, for the same reason.
 */
export const toGraphQLHouseholdMember = (
  row: MembershipWithUserRow,
  household: HouseholdRow,
  settings: SettingsRow,
): GraphQLMembership => ({
  id: row.id,
  household: toGraphQLHousehold(household, [], settings),
  user: toGraphQLUser(row.user),
  role: row.role,
  joinedAt: row.joinedAt.toISOString(),
});
