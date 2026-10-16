import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists which household a signed-in user chose to work in.
///
/// One slot, tagged with the owning user id: a value written by user A is
/// never returned to user B ([read] compares the stored owner), and sign-out
/// wipes the slot ([clear]). A household id is not a credential, so plain
/// shared preferences are enough.
abstract interface class ActiveHouseholdStore {
  /// The household [userId] last chose, or null when none is stored (or the
  /// stored choice belongs to someone else).
  Future<String?> read(String userId);

  Future<void> write(String userId, String householdId);

  Future<void> clear();
}

/// [ActiveHouseholdStore] backed by `shared_preferences`.
class SharedPreferencesActiveHouseholdStore implements ActiveHouseholdStore {
  const SharedPreferencesActiveHouseholdStore();

  static const String storageKey = 'active_household.v1';

  @override
  Future<String?> read(String userId) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final List<String>? slot = prefs.getStringList(storageKey);
    if (slot == null || slot.length != 2 || slot.first != userId) {
      return null;
    }
    return slot.last;
  }

  @override
  Future<void> write(String userId, String householdId) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(storageKey, <String>[userId, householdId]);
  }

  @override
  Future<void> clear() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.remove(storageKey);
  }
}

final Provider<ActiveHouseholdStore> activeHouseholdStoreProvider =
    Provider<ActiveHouseholdStore>(
      (Ref ref) => const SharedPreferencesActiveHouseholdStore(),
    );
