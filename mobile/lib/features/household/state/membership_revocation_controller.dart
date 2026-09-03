import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../pantry/state/pantry_controller.dart';
import '../../recipes/state/recipe_library_controller.dart';
import '../data/household_repository.dart';
import 'current_household_controller.dart';

/// Reacts to a live `onMembershipRevoked` push for [householdId] (D7,
/// E2E_MVP_PLAN.md §17.2.7) — the subscribe-time-only re-authorization gap
/// fix: a member whose access is revoked mid-session (via `deleteHousehold`)
/// otherwise keeps every other already-open live-update subscription for
/// this household alive until they background/foreground or their
/// connection drops for an unrelated reason.
///
/// `state` starts `false` and flips to `true` the moment a push lands — the
/// UI layer (`goRouterProvider`'s shell guard, `app/router.dart`) watches
/// this to route away; this controller's own job stops at "something is
/// revoked" plus tearing down the household-id-keyed controllers it can
/// address directly (see [_handleRevoked]'s own doc).
///
/// A *family*, same reasoning as `CurrentHouseholdController` — one instance
/// per household id, independent of any other household the caller may also
/// belong to (cross-household isolation: a push for household A must never
/// affect a still-live subscription for household B).
class MembershipRevocationController extends FamilyAsyncNotifier<bool, String> {
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  /// Not `late final` — same reasoning as `CurrentHouseholdController`'s
  /// identical field: `build()` can run more than once on the same notifier
  /// instance.
  StreamSubscription<void>? _revokedSubscription;

  @override
  Future<bool> build(String householdId) {
    unawaited(_revokedSubscription?.cancel());
    _revokedSubscription = _repository
        .watchMembershipRevoked(householdId)
        .listen(
          (_) => _handleRevoked(householdId),
          // A live-update channel that never connects must not fail this
          // controller's own state — same "errors swallowed" contract as
          // every other `watchXChanges` listener in this codebase.
          onError: (Object _) {},
        );
    ref.onDispose(() => unawaited(_revokedSubscription?.cancel()));

    return Future<bool>.value(false);
  }

  /// Flips [state] to `true` FIRST, then tears down every OTHER live
  /// subscription this app can address directly by [householdId] alone —
  /// `CurrentHouseholdController`, `PantryController`,
  /// `RecipeLibraryController` — by invalidating their provider instances,
  /// the same mechanism `PantryFormController` already uses after a
  /// successful mutation (`ref.invalidate(pantryControllerProvider(...))`).
  /// Invalidating triggers each controller's own `ref.onDispose`, which
  /// cancels its live-update `StreamSubscription` — the identical teardown
  /// that already runs when a screen unmounts normally, just triggered
  /// explicitly and immediately here instead of waiting for that.
  ///
  /// **Ordering is load-bearing** (flutter-reviewer HIGH finding): setting
  /// `state` first, ahead of the `ref.invalidate` calls below, is what lets
  /// `_MembershipRevocationGuard` (`app/router.dart`)'s `ref.listen` —
  /// notified synchronously by the assignment — call `context.go` and start
  /// navigating away BEFORE any sibling controller still being watched by an
  /// on-screen widget gets rebuilt. If a sibling controller's screen is
  /// still mounted at the moment `ref.invalidate` runs (Flutter does not
  /// unmount synchronously within this call), that rebuild re-issues a
  /// fetch/re-subscribe against the just-deleted household — wasted, and
  /// *usually* (not always) denied immediately: `deleteHousehold`
  /// cascade-deletes the membership row and its own resolver evicts the
  /// *deleting* caller's cache entry, but `requireHouseholdMember`'s
  /// subscribe-time check for every OTHER member reads a ≤30s, per-container
  /// positive-result cache it does not proactively evict for them (an
  /// already-accepted trade-off, `requireHouseholdMember.ts`'s own doc) — so
  /// a resubscribe landing on a warm Lambda container that cached this
  /// member's membership moments earlier can succeed for up to that window.
  /// Not a data-exposure risk even then: the underlying rows are gone in the
  /// same transaction, so a stale-cache-approved resubscribe finds nothing
  /// to return. Putting the navigation trigger first still keeps the *usual*
  /// resubscribe-then-denied case to at most one frame before the screen
  /// showing it disappears, rather than an unbounded one.
  ///
  /// Composite-keyed controllers (`CurrentMenuController`, keyed by
  /// household + week; `RecipeDetailController`, keyed by household + recipe
  /// id) are **not** invalidated here — Riverpod has no API to invalidate
  /// "every family instance whose key starts with this household id"
  /// without a live registry of which composite keys are currently mounted,
  /// which this codebase does not keep. This is an accepted, narrower scope
  /// than a fully general teardown, matching this plan's own style of
  /// documenting a gap rather than silently leaving it undiscoverable
  /// (§17.5.4/§17.5.5's identical pattern) — the app-shell navigation-away
  /// this state ultimately drives (`app/router.dart`) still removes those
  /// screens from view even though their underlying provider state is not
  /// explicitly invalidated.
  void _handleRevoked(String householdId) {
    state = const AsyncData<bool>(true);
    ref.invalidate(currentHouseholdControllerProvider(householdId));
    ref.invalidate(pantryControllerProvider(householdId));
    ref.invalidate(recipeLibraryControllerProvider(householdId));
  }
}

final AsyncNotifierProviderFamily<MembershipRevocationController, bool, String>
membershipRevocationControllerProvider =
    AsyncNotifierProvider.family<MembershipRevocationController, bool, String>(
      MembershipRevocationController.new,
    );
