import 'package:mobile/features/household/domain/household.dart';

/// The exact JSON AppSync returns for the `CreateHousehold` operation defined
/// in `lib/shared/graphql/operations/create_household.graphql`.
///
/// `__typename` on every object is not decoration: `build.yaml` leaves
/// `add_typenames` at its default `true` (ferry's normalising cache needs it
/// to key entities), so the generated deserializers require the field.
///
/// `mealStructure` and `cuisineTier2Weights` are JSON **strings**, matching
/// `api/src/mappers/household.ts`'s `JSON.stringify` — not nested objects.
Map<String, dynamic> createHouseholdWireData({
  String id = 'household-1',
  String name = 'Kulkarni Kitchen',
  String inviteCode = 'ABC123',
  String subscriptionStatus = 'free',
  String role = 'primary',
}) => <String, dynamic>{
  'createHousehold': <String, dynamic>{
    '__typename': 'Household',
    'id': id,
    'name': name,
    'inviteCode': inviteCode,
    'primaryUserId': 'user-1',
    'subscriptionStatus': subscriptionStatus,
    'settings': <String, dynamic>{
      '__typename': 'HouseholdSettings',
      'householdId': id,
      'mealsEnabled': <String>['breakfast', 'lunch', 'dinner'],
      'mealStructure': '{"breakfast":{"items":2}}',
      'cuisineTier1': <String>['north_indian', 'south_indian'],
      'cuisineTier2Weights': '{"maharashtrian":0.6}',
      'dietaryTags': <String>['veg'],
      'allergens': <String>['peanut'],
      'skipIngredients': <String>['brinjal'],
    },
    'members': <dynamic>[
      <String, dynamic>{
        '__typename': 'HouseholdMembership',
        'id': 'membership-1',
        'role': role,
        'joinedAt': '2026-08-20T09:30:00.000Z',
        'user': <String, dynamic>{
          '__typename': 'User',
          'id': 'user-1',
          'email': 'asha@example.com',
          'displayName': 'Asha',
          'avatarUrl': null,
        },
      },
    ],
  },
};

/// The exact JSON AppSync returns for the `UpdateHouseholdSettings` operation
/// defined in `lib/shared/graphql/operations/update_household_settings.graphql`.
///
/// The mutation returns `HouseholdSettings!` — the *whole* settings object,
/// not just the patched fields — so this fixture is a complete settings row,
/// and the two `AWSJSON` fields are JSON **strings** for the same reason
/// [createHouseholdWireData]'s are.
Map<String, dynamic> updateHouseholdSettingsWireData({
  String householdId = 'household-1',
  List<String> mealsEnabled = const <String>['breakfast', 'lunch', 'dinner'],
  String mealStructure = '{"lunch":{"carb":2,"sabzi_dal":2,"accompaniment":1}}',
  List<String> cuisineTier1 = const <String>['north_indian', 'south_indian'],
  String cuisineTier2Weights = '{"punjabi":"more","marathi":"normal"}',
  List<String> dietaryTags = const <String>['veg', 'eggetarian'],
  List<String> allergens = const <String>['peanut'],
  List<String> skipIngredients = const <String>['mustard oil'],
}) => <String, dynamic>{
  'updateHouseholdSettings': <String, dynamic>{
    '__typename': 'HouseholdSettings',
    'householdId': householdId,
    'mealsEnabled': mealsEnabled,
    'mealStructure': mealStructure,
    'cuisineTier1': cuisineTier1,
    'cuisineTier2Weights': cuisineTier2Weights,
    'dietaryTags': dietaryTags,
    'allergens': allergens,
    'skipIngredients': skipIngredients,
  },
};

/// A ready-made domain [Household] for tests that only need *a* household and
/// do not care about the wire round trip.
final Household testHousehold = Household(
  id: 'household-1',
  name: 'Kulkarni Kitchen',
  inviteCode: 'ABC123',
  primaryUserId: 'user-1',
  subscriptionStatus: SubscriptionStatus.free,
  settings: const HouseholdSettings(
    householdId: 'household-1',
    mealsEnabled: <String>['breakfast', 'lunch', 'dinner'],
    mealStructureJson: '{"breakfast":{"items":2}}',
    cuisineTier1: <String>['north_indian'],
    cuisineTier2WeightsJson: '{"maharashtrian":0.6}',
    dietaryTags: <String>['veg'],
    allergens: <String>['peanut'],
    skipIngredients: <String>['brinjal'],
  ),
  members: <HouseholdMembership>[
    HouseholdMembership(
      id: 'membership-1',
      role: HouseholdRole.primary,
      joinedAt: DateTime.utc(2026, 8, 20, 9, 30),
      user: const HouseholdMember(
        id: 'user-1',
        email: 'asha@example.com',
        displayName: 'Asha',
      ),
    ),
  ],
);

/// The domain [HouseholdSettings] matching [updateHouseholdSettingsWireData]'s
/// defaults, for tests that need a settings value without a wire round trip.
const HouseholdSettings testHouseholdSettings = HouseholdSettings(
  householdId: 'household-1',
  mealsEnabled: <String>['breakfast', 'lunch', 'dinner'],
  mealStructureJson: '{"lunch":{"carb":2,"sabzi_dal":2,"accompaniment":1}}',
  cuisineTier1: <String>['north_indian', 'south_indian'],
  cuisineTier2WeightsJson: '{"punjabi":"more","marathi":"normal"}',
  dietaryTags: <String>['veg', 'eggetarian'],
  allergens: <String>['peanut'],
  skipIngredients: <String>['mustard oil'],
);
