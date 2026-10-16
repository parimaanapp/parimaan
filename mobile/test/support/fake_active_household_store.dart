import 'package:mobile/features/household/state/active_household_store.dart';

/// In-memory [ActiveHouseholdStore] so tests never touch the
/// `shared_preferences` plugin. Mirrors the real store's contract: one slot,
/// tagged with its owning user.
class InMemoryActiveHouseholdStore implements ActiveHouseholdStore {
  InMemoryActiveHouseholdStore({String? userId, String? householdId})
    : ownerId = userId,
      choiceId = householdId;

  String? ownerId;
  String? choiceId;

  /// Raw slot, for assertions.
  ({String? userId, String? householdId}) get slot =>
      (userId: ownerId, householdId: choiceId);

  int clearCount = 0;

  @override
  Future<String?> read(String userId) async =>
      ownerId == userId ? choiceId : null;

  @override
  Future<void> write(String userId, String householdId) async {
    ownerId = userId;
    choiceId = householdId;
  }

  @override
  Future<void> clear() async {
    clearCount++;
    ownerId = null;
    choiceId = null;
  }
}
