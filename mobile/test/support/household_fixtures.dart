import 'package:mobile/features/household/domain/household.dart';

/// One `Household` node exactly as AppSync serializes the shared
/// `HouseholdFields` fragment.
///
/// Four operations return this identical shape — `createHousehold`,
/// `joinHousehold`, `rotateInviteCode` and `Query.household` — so it is built
/// once here rather than four times, mirroring the fragment that made the four
/// selection sets one.
///
/// `__typename` on every object is not decoration: `build.yaml` leaves
/// `add_typenames` at its default `true` (ferry's normalising cache needs it
/// to key entities), so the generated deserializers require the field.
///
/// `mealStructure` and `cuisineTier2Weights` are JSON **strings**, matching
/// `api/src/mappers/household.ts`'s `JSON.stringify` — not nested objects.
Map<String, dynamic> householdWireNode({
  String id = 'household-1',
  String name = 'Kulkarni Kitchen',
  String inviteCode = 'ABC123',
  String primaryUserId = 'user-1',
  String subscriptionStatus = 'free',
  String role = 'primary',
  List<String> dietaryTags = const <String>['veg'],
  List<String> cuisineTier1 = const <String>['north_indian', 'south_indian'],
  List<Map<String, dynamic>>? members,
}) => <String, dynamic>{
  '__typename': 'Household',
  'id': id,
  'name': name,
  'inviteCode': inviteCode,
  'primaryUserId': primaryUserId,
  'subscriptionStatus': subscriptionStatus,
  'settings': <String, dynamic>{
    '__typename': 'HouseholdSettings',
    'householdId': id,
    'mealsEnabled': <String>['breakfast', 'lunch', 'dinner'],
    'mealStructure': '{"breakfast":{"items":2}}',
    'cuisineTier1': cuisineTier1,
    'cuisineTier2Weights': '{"maharashtrian":0.6}',
    'dietaryTags': dietaryTags,
    'allergens': <String>['peanut'],
    'skipIngredients': <String>['brinjal'],
  },
  'members':
      members ??
      <Map<String, dynamic>>[
        householdMemberWireNode(
          membershipId: 'membership-1',
          userId: 'user-1',
          role: role,
          email: 'asha@example.com',
          displayName: 'Asha',
        ),
      ],
};

/// One `HouseholdMembership` node, for tests that need a specific roster
/// rather than the single-primary default.
Map<String, dynamic> householdMemberWireNode({
  required String membershipId,
  required String userId,
  required String role,
  required String email,
  String? displayName,
  String? avatarUrl,
  String joinedAt = '2026-08-20T09:30:00.000Z',
}) => <String, dynamic>{
  '__typename': 'HouseholdMembership',
  'id': membershipId,
  'role': role,
  'joinedAt': joinedAt,
  'user': <String, dynamic>{
    '__typename': 'User',
    'id': userId,
    'email': email,
    'displayName': displayName,
    'avatarUrl': avatarUrl,
  },
};

/// The exact JSON AppSync returns for the `CreateHousehold` operation defined
/// in `lib/shared/graphql/operations/create_household.graphql`.
Map<String, dynamic> createHouseholdWireData({
  String id = 'household-1',
  String name = 'Kulkarni Kitchen',
  String inviteCode = 'ABC123',
  String subscriptionStatus = 'free',
  String role = 'primary',
}) => <String, dynamic>{
  'createHousehold': householdWireNode(
    id: id,
    name: name,
    inviteCode: inviteCode,
    subscriptionStatus: subscriptionStatus,
    role: role,
  ),
};

/// The exact JSON AppSync returns for the `JoinHousehold` mutation.
///
/// The joining caller is a `member`, never a `primary` — that is what
/// `api/src/resolvers/joinHousehold.ts` inserts — so the default roster here
/// is the household's primary **plus** the caller.
Map<String, dynamic> joinHouseholdWireData({
  String id = 'household-1',
  String name = 'Kulkarni Kitchen',
  String inviteCode = 'ABC123',
}) => <String, dynamic>{
  'joinHousehold': householdWireNode(
    id: id,
    name: name,
    inviteCode: inviteCode,
    members: <Map<String, dynamic>>[
      householdMemberWireNode(
        membershipId: 'membership-1',
        userId: 'user-1',
        role: 'primary',
        email: 'asha@example.com',
        displayName: 'Asha',
      ),
      householdMemberWireNode(
        membershipId: 'membership-2',
        userId: 'user-2',
        role: 'member',
        email: 'raj@example.com',
        displayName: 'Raj',
      ),
    ],
  ),
};

/// The exact JSON AppSync returns for the `Household` query.
Map<String, dynamic> householdQueryWireData({
  String id = 'household-1',
  String name = 'Kulkarni Kitchen',
  String inviteCode = 'ABC123',
  List<Map<String, dynamic>>? members,
}) => <String, dynamic>{
  'household': householdWireNode(
    id: id,
    name: name,
    inviteCode: inviteCode,
    members: members,
  ),
};

/// The exact JSON AppSync returns for the `RotateInviteCode` mutation — the
/// same household, carrying its **new** code.
Map<String, dynamic> rotateInviteCodeWireData({
  String id = 'household-1',
  String inviteCode = 'ZY9WX8',
}) => <String, dynamic>{
  'rotateInviteCode': householdWireNode(id: id, inviteCode: inviteCode),
};

/// One `Query.me.households[]` node, matching `me.graphql`'s selection: the
/// nested `household` carries no `members` (see that file's doc for the
/// cycle this avoids), so [householdWireNode]'s `members` key is stripped
/// rather than defaulted — a wire node with a `members` field would silently
/// pass a shape `me.graphql` cannot actually produce.
Map<String, dynamic> meHouseholdMembershipWireNode({
  String membershipId = 'membership-1',
  String role = 'primary',
  String joinedAt = '2026-08-20T09:30:00.000Z',
  String id = 'household-1',
  String name = 'Kulkarni Kitchen',
  String inviteCode = 'ABC123',
}) {
  final Map<String, dynamic> household = householdWireNode(
    id: id,
    name: name,
    inviteCode: inviteCode,
  )..remove('members');
  return <String, dynamic>{
    '__typename': 'HouseholdMembership',
    'id': membershipId,
    'role': role,
    'joinedAt': joinedAt,
    'household': household,
  };
}

/// The exact JSON AppSync returns for the `Me` query.
Map<String, dynamic> meWireData({
  String userId = 'user-1',
  String email = 'asha@example.com',
  String? displayName = 'Asha',
  List<Map<String, dynamic>> households = const <Map<String, dynamic>>[],
}) => <String, dynamic>{
  'me': <String, dynamic>{
    '__typename': 'User',
    'id': userId,
    'email': email,
    'displayName': displayName,
    'avatarUrl': null,
    'households': households,
  },
};

/// `Mutation.leaveHousehold`'s bare `Boolean!` payload.
Map<String, dynamic> leaveHouseholdWireData({bool result = true}) =>
    <String, dynamic>{'leaveHousehold': result};

/// `Mutation.deleteHousehold`'s bare `Boolean!` payload.
Map<String, dynamic> deleteHouseholdWireData({bool result = true}) =>
    <String, dynamic>{'deleteHousehold': result};

/// The exact JSON AppSync returns for the `UpdateHouseholdSettings` operation
/// defined in `lib/shared/graphql/operations/update_household_settings.graphql`.
///
/// The mutation returns the **whole `Household`**, not just settings (W8
/// S10, E2E_MVP_PLAN.md §14.2.10 D4 — widened so it can attach to
/// `Subscription.onHouseholdChanged`) — this fixture wraps [householdWireNode]
/// with its `settings` block replaced by the patched values, mirroring the
/// other four `Household`-returning operations. The two `AWSJSON` fields are
/// JSON **strings** for the same reason [createHouseholdWireData]'s are.
Map<String, dynamic> updateHouseholdSettingsWireData({
  String householdId = 'household-1',
  List<String> mealsEnabled = const <String>['breakfast', 'lunch', 'dinner'],
  String mealStructure = '{"lunch":{"carb":2,"sabzi_dal":2,"accompaniment":1}}',
  List<String> cuisineTier1 = const <String>['north_indian', 'south_indian'],
  String cuisineTier2Weights = '{"punjabi":"more","marathi":"normal"}',
  List<String> dietaryTags = const <String>['veg', 'eggetarian'],
  List<String> allergens = const <String>['peanut'],
  List<String> skipIngredients = const <String>['mustard oil'],
}) {
  final Map<String, dynamic> household = householdWireNode(id: householdId)
    ..['settings'] = <String, dynamic>{
      '__typename': 'HouseholdSettings',
      'householdId': householdId,
      'mealsEnabled': mealsEnabled,
      'mealStructure': mealStructure,
      'cuisineTier1': cuisineTier1,
      'cuisineTier2Weights': cuisineTier2Weights,
      'dietaryTags': dietaryTags,
      'allergens': allergens,
      'skipIngredients': skipIngredients,
    };
  return <String, dynamic>{'updateHouseholdSettings': household};
}

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
/// own settings-field defaults, for tests that need a settings value without
/// a wire round trip. Compare against a mapped result's `.settings`, not the
/// whole `Household` — `Household`'s own `operator==` compares by `id` only.
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

/// A four-member household whose primary is `user-1`.
///
/// The Members-list and Settings screens both branch on the caller's role, so
/// they need a roster with more than one person in it — [testHousehold]'s
/// single-primary roster cannot exercise either branch.
final Household testHouseholdWithMembers = Household(
  id: 'household-1',
  name: 'Kulkarni Kitchen',
  inviteCode: 'ABC123',
  primaryUserId: 'user-1',
  subscriptionStatus: SubscriptionStatus.free,
  settings: testHousehold.settings,
  members: <HouseholdMembership>[
    HouseholdMembership(
      id: 'membership-1',
      role: HouseholdRole.primary,
      joinedAt: DateTime.utc(2026, 8, 20, 9, 30),
      user: const HouseholdMember(
        id: 'user-1',
        email: 'amogh@example.com',
        displayName: 'Amogh',
      ),
    ),
    HouseholdMembership(
      id: 'membership-2',
      role: HouseholdRole.member,
      joinedAt: DateTime.utc(2026, 8, 21, 9, 30),
      user: const HouseholdMember(
        id: 'user-2',
        email: 'priya@example.com',
        displayName: 'Priya',
      ),
    ),
    HouseholdMembership(
      id: 'membership-3',
      role: HouseholdRole.member,
      joinedAt: DateTime.utc(2026, 8, 22, 9, 30),
      user: const HouseholdMember(id: 'user-3', email: 'aai@example.com'),
    ),
    HouseholdMembership(
      id: 'membership-4',
      role: HouseholdRole.member,
      joinedAt: DateTime.utc(2026, 8, 23, 9, 30),
      user: const HouseholdMember(
        id: 'user-4',
        email: 'baba@example.com',
        displayName: 'Baba',
      ),
    ),
  ],
);
