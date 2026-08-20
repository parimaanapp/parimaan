/// The app's own household types, independent of GraphQL and of `built_value`.
///
/// Nothing generated appears in this file, and nothing should. Same rule
/// `auth_session.dart` follows for Amplify: the wire format stops at the data
/// layer. `Household` is what the router, the controllers and every screen
/// depend on, so leaking `GCreateHouseholdData_createHousehold` here would tie
/// the whole UI to one operation's selection set — re-shaping that query would
/// then be a rewrite rather than a one-file change.
///
/// The mapping from the generated types lives next door in
/// `../data/household_mapper.dart`.
library;

/// A member's role in a household.
///
/// [unknown] is not in `shared/schema.graphql` and never comes off the wire as
/// itself. It is the landing spot for a value this build has never heard of —
/// a role the server grows after this binary ships. `build.yaml` sets
/// `global_enum_fallbacks: true` so the generated enums have their own
/// `gUnknownEnumValue` rather than failing to deserialize; this member is that
/// idea carried through to the domain, so an unknown role degrades one field
/// instead of failing a whole response.
enum HouseholdRole {
  primary,
  member,
  unknown;

  bool get isPrimary => this == HouseholdRole.primary;
}

/// A household's billing state. Five real values, per `SubscriptionStatus` in
/// `shared/schema.graphql`, plus the same forward-compatibility [unknown] as
/// [HouseholdRole].
///
/// `pastDue` is `past_due` on the wire — the Dart name is lower-camel to match
/// the language's own convention; the mapper owns the translation, and
/// `api/src/mappers/household.ts` explicitly warns against "helpfully"
/// reformatting these strings anywhere else.
enum SubscriptionStatus { free, trial, active, pastDue, cancelled, unknown }

/// A user as seen through a household membership.
///
/// Deliberately not `SignedIn` from the auth feature: that type describes *the
/// caller*, this one describes *any* member, and conflating them would make
/// every co-member look like a session.
class HouseholdMember {
  const HouseholdMember({
    required this.id,
    required this.email,
    this.displayName,
    this.avatarUrl,
  });

  final String id;
  final String email;
  final String? displayName;
  final String? avatarUrl;

  /// What to show in a member list. Falls back to the email's local part
  /// rather than the whole address — a household screen showing five full
  /// email addresses is both ugly and more PII on screen than it needs.
  String get label => displayName?.trim().isNotEmpty ?? false
      ? displayName!.trim()
      : email.split('@').first;

  /// Email is omitted on purpose — `toString` ends up in crash reports.
  @override
  String toString() => 'HouseholdMember(id: $id)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is HouseholdMember &&
          other.id == id &&
          other.email == email &&
          other.displayName == displayName &&
          other.avatarUrl == avatarUrl;

  @override
  int get hashCode => Object.hash(id, email, displayName, avatarUrl);
}

/// One person's membership of one household.
class HouseholdMembership {
  const HouseholdMembership({
    required this.id,
    required this.role,
    required this.joinedAt,
    required this.user,
  });

  final String id;
  final HouseholdRole role;
  final DateTime joinedAt;
  final HouseholdMember user;

  @override
  String toString() =>
      'HouseholdMembership(id: $id, role: ${role.name}, user: ${user.id})';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is HouseholdMembership &&
          other.id == id &&
          other.role == role &&
          other.joinedAt == joinedAt &&
          other.user == user;

  @override
  int get hashCode => Object.hash(id, role, joinedAt, user);
}

/// A household's planning preferences.
///
/// Two shape decisions worth naming:
///
///  * `mealsEnabled` / `cuisineTier1` / `dietaryTags` are `List<String>` of the
///    server's own enum value names, not Dart enums. The screens that give
///    those meaning are a later slice, and inventing three more enums plus
///    three more `unknown` members now would be speculative generality with no
///    consumer. They are carried through byte-for-byte, exactly as
///    `api/src/mappers/household.ts` insists.
///  * The two `AWSJSON` fields stay **raw JSON strings**, and their names say
///    so. That is genuinely what is on the wire — `toGraphQLSettings` emits
///    `JSON.stringify(...)` — so decoding them here, before anything needs
///    their structure, would only move a parse failure earlier and hide the
///    fact that these are unvalidated blobs.
class HouseholdSettings {
  const HouseholdSettings({
    required this.householdId,
    required this.mealsEnabled,
    required this.mealStructureJson,
    required this.cuisineTier1,
    required this.cuisineTier2WeightsJson,
    required this.dietaryTags,
    required this.allergens,
    required this.skipIngredients,
  });

  final String householdId;
  final List<String> mealsEnabled;

  /// `AWSJSON` — a JSON document as a string. Not yet decoded; see class doc.
  final String mealStructureJson;

  final List<String> cuisineTier1;

  /// `AWSJSON` — a JSON document as a string. Not yet decoded; see class doc.
  final String cuisineTier2WeightsJson;

  final List<String> dietaryTags;
  final List<String> allergens;
  final List<String> skipIngredients;

  // Sibling domain types (HouseholdMember, HouseholdMembership) implement
  // value equality; this one did not, purely by oversight — nothing about
  // settings makes it special. `Household.==` still doesn't compare
  // `settings` (entity identity via `id` is enough there), but this type on
  // its own should behave like every other value type in this file, e.g. in
  // a `Set` or a Riverpod `select`.
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is HouseholdSettings &&
          householdId == other.householdId &&
          _listEquals(mealsEnabled, other.mealsEnabled) &&
          mealStructureJson == other.mealStructureJson &&
          _listEquals(cuisineTier1, other.cuisineTier1) &&
          cuisineTier2WeightsJson == other.cuisineTier2WeightsJson &&
          _listEquals(dietaryTags, other.dietaryTags) &&
          _listEquals(allergens, other.allergens) &&
          _listEquals(skipIngredients, other.skipIngredients);

  @override
  int get hashCode => Object.hash(
    householdId,
    Object.hashAll(mealsEnabled),
    mealStructureJson,
    Object.hashAll(cuisineTier1),
    cuisineTier2WeightsJson,
    Object.hashAll(dietaryTags),
    Object.hashAll(allergens),
    Object.hashAll(skipIngredients),
  );

  @override
  String toString() => 'HouseholdSettings(householdId: $householdId)';
}

/// A household, as the UI understands it.
class Household {
  const Household({
    required this.id,
    required this.name,
    required this.inviteCode,
    required this.primaryUserId,
    required this.subscriptionStatus,
    required this.settings,
    required this.members,
  });

  final String id;
  final String name;

  /// The share code co-members join with. Treat as a credential: it is the
  /// only thing standing between a stranger and this household's data, which
  /// is why the server rate-limits guesses (`RATE_LIMITED`).
  final String inviteCode;

  final String primaryUserId;
  final SubscriptionStatus subscriptionStatus;
  final HouseholdSettings settings;
  final List<HouseholdMembership> members;

  /// Whether [userId] is this household's primary member.
  bool isPrimary(String userId) => primaryUserId == userId;

  /// `inviteCode` is omitted on purpose — `toString` ends up in logs and crash
  /// reports, and this one is a credential.
  @override
  String toString() => 'Household(id: $id, name: $name)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is Household && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// Order-sensitive list equality for [HouseholdSettings.==] — order is part
/// of the value here (these lists round-trip to the server as JSON arrays,
/// where order is preserved), so this is deliberately not a set comparison.
bool _listEquals(List<String> a, List<String> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
