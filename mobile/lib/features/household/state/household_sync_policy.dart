import 'dart:async';

import 'package:flutter/widgets.dart' show AppLifecycleState;

/// When household-scoped screens re-read the server, for the gaps a live
/// push can't itself cover (E2E_MVP_PLAN.md §14.2.10, D4/D5, W8 S10).
///
/// ## Scope boundary — read this before extending it
///
/// `Subscription.onHouseholdChanged` (W8 S10) now pushes live for a join, an
/// invite-code rotation, or a settings change — see
/// `HouseholdRepository.watchHouseholdChanges`, wired into
/// `CurrentHouseholdController`. This class's 15-second poll and its
/// idle-decay machinery (the mechanism that covered household changes
/// before that subscription existed) are gone — polling on a timer to catch
/// up with a server that now pushes is pure waste. What is left covers what
/// a live push structurally cannot:
///
///  1. **Refetch on route entry** — [start]. A screen that wasn't mounted
///     (and so wasn't subscribed) when a push happened has nothing to have
///     received.
///  2. **Refetch on foreground** — [onLifecycleChanged] with
///     `AppLifecycleState.resumed`. The socket disconnects while
///     backgrounded (W8 S4) — this is what makes the household roster
///     correct again on return, not the subscription itself.
///
/// This does **not** cover a member leaving or a household being deleted —
/// `leaveHousehold`/`deleteHousehold` are deliberately not attached to
/// `onHouseholdChanged` (see the SDL's own doc on that field for why:
/// both return `Boolean!`, which can't feed a `Household`-shaped
/// subscription, and attaching either would run this field's own
/// `Household.members`/`Household.settings` resolvers for a caller who has
/// just stopped being a member). That staleness gap is accepted, and is
/// exactly what route-entry/foreground refetches above still close on next
/// visit — not instantly, but not never either.
///
/// Explicitly **out of scope**, unchanged from before W8 S10:
///
///  * No retry, no backoff, no jitter on either trigger — a failed refetch
///    is dropped; the next entry or foreground tries again.
///  * No cache invalidation and no cross-screen fan-out. `fetchHousehold`
///    uses `FetchPolicy.NoCache` precisely so this never writes into
///    ferry's normalised cache underneath another screen.
///  * No conflict resolution or optimistic merging. The server's snapshot
///    wins, wholesale, every time.
///  * No offline queue and no connectivity awareness.
class HouseholdSyncPolicy {
  HouseholdSyncPolicy({required Future<void> Function() refetch})
    // Not an initializing formal: Dart forbids a named parameter beginning
    // with an underscore, and this field is private because nothing outside
    // may swap the callback after construction.
    // ignore: prefer_initializing_formals
    : _refetch = refetch;

  final Future<void> Function() _refetch;

  bool _disposed = false;

  /// Guards against overlapping requests — an entry refetch and a
  /// same-instant foreground refetch racing each other is the only way two
  /// calls could overlap now that there is no poll timer, but the guard
  /// stays for the identical reason it always existed: an Aurora cold start
  /// can hold a fetch open long enough for a second trigger to land while
  /// the first is still in flight.
  bool _inFlight = false;

  /// Whether [start] has ever run — distinguishes "not started" from
  /// "stopped", so a `resumed` event arriving before this policy owns a
  /// screen (or after [dispose]) is a no-op rather than an unowned refetch.
  bool _hasStarted = false;

  /// Enters the screen: refetch now. Safe to call repeatedly — each call is
  /// a genuine route entry and so does refetch.
  void start() {
    if (_disposed) {
      return;
    }
    _hasStarted = true;
    _fire();
  }

  /// Leaves the screen. Idempotent, and — with no poll timer left to stop —
  /// currently a no-op. Kept as a real method (not deleted) so
  /// `HouseholdSyncScope`'s own mount/unmount symmetry needs no
  /// special-casing, and so a future trigger this class grows has somewhere
  /// to hook the "leaving" half of its own lifecycle.
  void stop() {}

  /// Reacts to the app moving between foreground and background.
  ///
  /// `resumed` is a refetch trigger in its own right: an app that was
  /// backgrounded for an hour is showing an hour-old roster, and that is the
  /// single most likely moment for the data on screen to be wrong. Every
  /// other state is ignored — there is no cadence left to stop.
  void onLifecycleChanged(AppLifecycleState state) {
    if (_disposed || state != AppLifecycleState.resumed) {
      return;
    }
    // Only revive a policy that owns a screen. A `resumed` event arriving
    // before `start()` belongs to a screen this policy is not driving yet.
    if (_hasStarted) {
      _fire();
    }
  }

  /// Marks this policy permanently inert, so a late lifecycle callback from
  /// a disposed widget cannot trigger a refetch for a screen that is gone.
  void dispose() {
    _disposed = true;
  }

  /// Runs one refetch, swallowing whatever it throws.
  ///
  /// Swallowing is right *here* and only here: the controller behind
  /// [_refetch] already parks failures in its own `AsyncValue` where the
  /// screen renders them. Letting the error escape here would reach
  /// `FlutterError.onError` as an unhandled async exception and fail widget
  /// tests, while telling the user nothing they are not already being told.
  void _fire() {
    if (_inFlight) {
      return;
    }
    _inFlight = true;
    unawaited(
      _refetch()
          .catchError((Object _) {})
          .whenComplete(() => _inFlight = false),
    );
  }
}
