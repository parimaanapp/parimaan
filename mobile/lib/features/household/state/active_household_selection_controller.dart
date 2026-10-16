import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/domain/auth_session.dart';
import '../../auth/state/auth_controller.dart';
import '../domain/household.dart';
import 'active_household_store.dart';
import 'household_scope_invalidation.dart';
import 'me_households_controller.dart';

/// The household id the signed-in user explicitly chose, or null.
///
/// ## Session isolation (A9)
///
/// `build` watches the signed-in user's id, so a different user (or a sign-out)
/// rebuilds this controller and the previous user's choice can never leak: the
/// store is keyed by user, and a signed-out session resolves to null without
/// touching the store. The id is *only a preference* — `activeHouseholdProvider`
/// honours it solely when the server's household list for the current user
/// contains it, so a stale or foreign id is ignored.
///
/// While the stored choice is still loading the value is `AsyncLoading`;
/// readers that must not act on the wrong household (the router's activity
/// check) wait for it.
class ActiveHouseholdSelectionController extends AsyncNotifier<String?> {
  @override
  Future<String?> build() async {
    final String? userId = ref.watch(
      authControllerProvider.select((AsyncValue<AuthSession> auth) {
        final AuthSession? session = auth.valueOrNull;
        return session is SignedIn ? session.userId : null;
      }),
    );
    if (userId == null) {
      return null;
    }
    try {
      return await ref.read(activeHouseholdStoreProvider).read(userId);
    } on Object {
      // An unreadable preference is not worth failing the app over: fall back
      // to the default household.
      return null;
    }
  }

  /// Makes [householdId] the active household.
  ///
  /// Returns false (and changes nothing) when nobody is signed in or
  /// [householdId] is not in the server's list for this user. Otherwise the
  /// choice is persisted (best effort), every household-scoped provider is
  /// invalidated, and true is returned.
  Future<bool> select(String householdId) async {
    final AuthSession? session = ref.read(authControllerProvider).valueOrNull;
    final List<Household>? households = ref
        .read(meHouseholdsControllerProvider)
        .valueOrNull;
    if (session is! SignedIn ||
        households == null ||
        !households.any((Household h) => h.id == householdId)) {
      return false;
    }

    state = AsyncData<String?>(householdId);
    invalidateHouseholdScopedState(ref);
    try {
      await ref
          .read(activeHouseholdStoreProvider)
          .write(session.userId, householdId);
    } on Object {
      // In-memory choice still applies for this run.
    }
    return true;
  }
}

final AsyncNotifierProvider<ActiveHouseholdSelectionController, String?>
activeHouseholdSelectionControllerProvider =
    AsyncNotifierProvider<ActiveHouseholdSelectionController, String?>(
      ActiveHouseholdSelectionController.new,
    );
