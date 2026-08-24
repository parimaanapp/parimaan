import 'package:built_collection/built_collection.dart';

import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/operations/__generated__/household_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/household_settings_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/me.data.gql.dart';
import '../domain/cuisine_taxonomy.dart';
import '../domain/dietary_tag.dart';
import '../domain/household.dart';
import '../domain/household_settings_patch.dart';
import '../domain/meal_type.dart';

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
///
/// ## One mapper for four operations
///
/// The parameter type is the **fragment** interface `GHouseholdFields`, not
/// any one operation's data class. `createHousehold`, `joinHousehold`,
/// `rotateInviteCode` and `Query.household` all spread
/// `...HouseholdFields`, and ferry makes each of their generated data classes
/// `implements GHouseholdFields` — so all four map through this single
/// function.
///
/// That is a change from the previous shape, which took
/// `GCreateHouseholdData_createHousehold` directly and had a hand-duplicated
/// twin for `updateHouseholdSettings` (this file's own comment called that
/// duplication deliberate-but-unhappy, because ferry generates a
/// *structurally identical but nominally distinct* class per operation and
/// there was no shared supertype to program against). A fragment **is** that
/// shared supertype, so the duplication is now gone rather than merely
/// justified.
Household householdFromGraphQL(GHouseholdFields data) => Household(
  id: data.id,
  name: data.name,
  inviteCode: data.inviteCode,
  primaryUserId: data.primaryUserId,
  subscriptionStatus: subscriptionStatusFromGraphQL(data.subscriptionStatus),
  settings: householdSettingsFromGraphQL(data.settings),
  members: data.members.map(_membershipFromGraphQL).toList(growable: false),
);

/// Maps `Query.me`'s `households[].household` — the same fields as
/// [householdFromGraphQL], minus `members`, which `me.graphql` deliberately
/// does not request (see that file's doc for the cycle this avoids).
///
/// `members` is `const []` here for the same reason the doc on that field's
/// call sites already gives: the server itself returns an empty list for a
/// membership's own household when asked, so an empty list is not a lie of
/// omission — it is what the server would say anyway.
Household meHouseholdFromGraphQL(GMeData_me_households_household data) =>
    Household(
      id: data.id,
      name: data.name,
      inviteCode: data.inviteCode,
      primaryUserId: data.primaryUserId,
      subscriptionStatus: subscriptionStatusFromGraphQL(
        data.subscriptionStatus,
      ),
      settings: householdSettingsFromGraphQL(data.settings),
      members: const <HouseholdMembership>[],
    );

HouseholdMembership _membershipFromGraphQL(
  GHouseholdFields_members membership,
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

/// Maps any `HouseholdSettings` payload to the domain [HouseholdSettings].
///
/// Takes the `HouseholdSettingsFields` fragment interface, so the one function
/// serves both consumers: `updateHouseholdSettings` (which returns
/// `HouseholdSettings!` on its own) and the `settings` field nested inside
/// `HouseholdFields`. That is precisely why the settings selection is a
/// fragment of its own rather than inlined into `HouseholdFields`.
///
/// `mealsEnabled` / `cuisineTier1` / `dietaryTags` are carried through as the
/// server's own enum value **names**, per `HouseholdSettings`' class doc —
/// including `gUnknownEnumValue`'s name for a value this build predates, which
/// degrades one list entry instead of failing the whole response.
///
/// The two `AWSJSON` fields stay raw JSON strings. See [HouseholdSettings]'
/// class doc and `api/src/mappers/household.ts`.
HouseholdSettings householdSettingsFromGraphQL(
  GHouseholdSettingsFields settings,
) => HouseholdSettings(
  householdId: settings.householdId,
  mealsEnabled: settings.mealsEnabled
      .map((GMealType value) => value.name)
      .toList(growable: false),
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

/// Builds the generated `HouseholdSettingsInput` from a domain
/// [HouseholdSettingsPatch].
///
/// **The absent/null distinction is the whole job here.** A `null` field on
/// the patch means "leave unchanged", and the corresponding builder field is
/// simply never assigned — `built_value` then omits it from the serialized
/// variables entirely. Assigning `null` instead would put an explicit `null`
/// on the wire, which `api/src/validation/updateHouseholdSettings.ts` rejects
/// as `VALIDATION`. The two look almost identical in Dart and are completely
/// different over HTTP, which is why every field below is guarded rather than
/// assigned unconditionally.
GHouseholdSettingsInput householdSettingsInputFromPatch(
  HouseholdSettingsPatch patch,
) => GHouseholdSettingsInput((GHouseholdSettingsInputBuilder b) {
  final List<MealType>? meals = patch.mealsEnabled;
  if (meals != null) {
    b.mealsEnabled = ListBuilder<GMealType>(meals.map(_mealTypeToGraphQL));
  }

  final String? mealStructure = patch.mealStructureJson;
  if (mealStructure != null) {
    b.mealStructure = mealStructure;
  }

  final List<CuisineRegion>? regions = patch.cuisineTier1;
  if (regions != null) {
    b.cuisineTier1 = ListBuilder<GCuisineTier1>(
      regions.map(_cuisineRegionToGraphQL),
    );
  }

  final String? weights = patch.cuisineTier2WeightsJson;
  if (weights != null) {
    b.cuisineTier2Weights = weights;
  }

  final List<DietaryTag>? tags = patch.dietaryTags;
  if (tags != null) {
    b.dietaryTags = ListBuilder<GDietaryTag>(tags.map(_dietaryTagToGraphQL));
  }

  final List<String>? allergens = patch.allergens;
  if (allergens != null) {
    b.allergens = ListBuilder<String>(allergens);
  }

  final List<String>? skipIngredients = patch.skipIngredients;
  if (skipIngredients != null) {
    b.skipIngredients = ListBuilder<String>(skipIngredients);
  }
});

// The three encode-direction enum maps. Exhaustive `switch` with no `_ =>`
// arm on purpose — unlike the decode direction, a domain value with no
// generated counterpart is a *build* error worth failing on, not a runtime
// value to degrade. `gUnknownEnumValue` is deliberately unreachable here:
// there is no user choice it could represent.

GMealType _mealTypeToGraphQL(MealType type) => switch (type) {
  MealType.breakfast => GMealType.breakfast,
  MealType.lunch => GMealType.lunch,
  MealType.snacks => GMealType.snacks,
  MealType.dinner => GMealType.dinner,
};

GCuisineTier1 _cuisineRegionToGraphQL(CuisineRegion region) => switch (region) {
  CuisineRegion.northIndian => GCuisineTier1.north_indian,
  CuisineRegion.southIndian => GCuisineTier1.south_indian,
  CuisineRegion.panIndia => GCuisineTier1.pan_india,
  CuisineRegion.indoChinese => GCuisineTier1.indo_chinese,
  CuisineRegion.continental => GCuisineTier1.continental,
};

GDietaryTag _dietaryTagToGraphQL(DietaryTag tag) => switch (tag) {
  DietaryTag.veg => GDietaryTag.veg,
  DietaryTag.vegan => GDietaryTag.vegan,
  DietaryTag.jain => GDietaryTag.jain,
  DietaryTag.eggetarian => GDietaryTag.eggetarian,
  DietaryTag.glutenFree => GDietaryTag.gluten_free,
  DietaryTag.dairyFree => GDietaryTag.dairy_free,
};
