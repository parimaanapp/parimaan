import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_household.data.gql.dart';
import '../domain/household.dart';

/// The boundary where Ferry / `built_value` types become plain domain types.
///
/// This file is the only one in `features/household/` allowed to import
/// anything from `__generated__/`, the same way `amplify_auth_repository.dart`
/// is the only file allowed to know Amplify exists.
///
/// ## Defensive enum mapping
///
/// Every generated enum is mapped through an exhaustive `switch` with a
/// `_ =>` arm landing on the domain's `unknown` member. Two layers of
/// forward-compatibility have to line up for that to work, and both are
/// deliberate:
///
/// 1. `build.yaml` sets `global_enum_fallbacks: true`, so an unrecognised wire
///    value **deserializes** to `gUnknownEnumValue` instead of throwing.
///    Without it, one new server-side enum value would fail the entire
///    response.
/// 2. The `_ =>` arms below then translate that (and any generated member this
///    code has not been updated for) to the domain `unknown`.
///
/// This is the first place in the codebase where generated enums are mapped,
/// so it is establishing the pattern rather than following one. The precedent
/// it does follow is `auth_session.dart`'s: degrade a field, never fail the
/// whole object.
Household householdFromGraphQL(GCreateHouseholdData_createHousehold data) =>
    Household(
      id: data.id,
      name: data.name,
      inviteCode: data.inviteCode,
      primaryUserId: data.primaryUserId,
      subscriptionStatus: subscriptionStatusFromGraphQL(
        data.subscriptionStatus,
      ),
      settings: _settingsFromGraphQL(data.settings),
      members: data.members.map(_membershipFromGraphQL).toList(growable: false),
    );

HouseholdSettings _settingsFromGraphQL(
  GCreateHouseholdData_createHousehold_settings settings,
) => HouseholdSettings(
  householdId: settings.householdId,
  mealsEnabled: settings.mealsEnabled
      .map((GMealType value) => value.name)
      .toList(growable: false),
  // `AWSJSON` — already a JSON string on the wire, kept as one. See
  // `HouseholdSettings`' class doc and `api/src/mappers/household.ts`.
  mealStructureJson: settings.mealStructure,
  cuisineTier1: settings.cuisineTier1
      .map((GCuisineTier1 value) => value.name)
      .toList(growable: false),
  cuisineTier2WeightsJson: settings.cuisineTier2Weights,
  dietaryTags: settings.dietaryTags
      .map((GDietaryTag value) => value.name)
      .toList(growable: false),
  allergens: settings.allergens.toList(growable: false),
  skipIngredients: settings.skipIngredients.toList(growable: false),
);

HouseholdMembership _membershipFromGraphQL(
  GCreateHouseholdData_createHousehold_members membership,
) => HouseholdMembership(
  id: membership.id,
  role: householdRoleFromGraphQL(membership.role),
  joinedAt: membership.joinedAt,
  user: HouseholdMember(
    id: membership.user.id,
    email: membership.user.email,
    displayName: membership.user.displayName,
    avatarUrl: membership.user.avatarUrl,
  ),
);

/// Visible for reuse by the household operations landing in later slices
/// (`joinHousehold`, `me`), which have their own generated data classes but
/// share these two schema-level enums.
HouseholdRole householdRoleFromGraphQL(GHouseholdRole role) => switch (role) {
  GHouseholdRole.primary => HouseholdRole.primary,
  GHouseholdRole.member => HouseholdRole.member,
  _ => HouseholdRole.unknown,
};

/// See [householdRoleFromGraphQL].
SubscriptionStatus subscriptionStatusFromGraphQL(GSubscriptionStatus status) =>
    switch (status) {
      GSubscriptionStatus.free => SubscriptionStatus.free,
      GSubscriptionStatus.trial => SubscriptionStatus.trial,
      GSubscriptionStatus.active => SubscriptionStatus.active,
      // `past_due` on the wire, `pastDue` in Dart — the only name this mapper
      // translates rather than passes through.
      GSubscriptionStatus.past_due => SubscriptionStatus.pastDue,
      GSubscriptionStatus.cancelled => SubscriptionStatus.cancelled,
      _ => SubscriptionStatus.unknown,
    };
