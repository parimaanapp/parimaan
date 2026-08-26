import 'dart:async';

import 'package:flutter/widgets.dart' show AppLifecycleState;

/// When household-scoped screens re-read the server, in the absence of
/// subscriptions.
///
/// ## Scope boundary — read this before extending it
///
/// This is a **placeholder for real-time**, not a synchronisation engine.
/// `onPantryChanged` shipped in W5 (S8) — this class is unrelated to it and
/// stays exactly as-is: it covers *household* membership changes
/// (`onHouseholdChanged`), which the locked plan defers to **W8**, a natural
/// follow-on once the WebSocket link S8 built already exists
/// (E2E_MVP_PLAN.md §11.2.10). Until then, a member who joins or leaves has
/// to become visible on another device *somehow*, and this is the cheapest
/// mechanism that makes that true without pretending to be more than it is.
///
/// It does exactly three things:
///
///  1. **Refetch on route entry** — [start].
///  2. **Refetch on foreground** — [onLifecycleChanged] with
///     `AppLifecycleState.resumed`.
///  3. **Poll every [pollInterval], decaying to off after [idleTimeout]** of no
///     interaction.
///
/// Explicitly **out of scope**, and deliberately absent rather than
/// forgotten — every one of these belongs to W8, where `onHouseholdChanged`
/// makes them answerable properly:
///
///  * No retry, no backoff, no jitter. A failed poll is dropped; the next tick
///    tries again. Retrying a poll that is about to repeat anyway is just a
///    second poll with extra machinery.
///  * No cache invalidation and no cross-screen fan-out. `fetchHousehold` uses
///    `FetchPolicy.NoCache` precisely so this never writes into ferry's
///    normalised cache underneath another screen.
///  * No conflict resolution or optimistic merging. The server's snapshot wins,
///    wholesale, every time.
///  * No offline queue and no connectivity awareness.
///
/// If a change to this class needs any of the above, that is the signal it
/// belongs in W8's `onHouseholdChanged` subscription work instead.
///
/// ## Why the idle decay exists
///
/// A 15-second poll left running forever is a battery and Aurora-cost leak on
/// a screen nobody is looking at — and Aurora Serverless v2 auto-pause (a
/// "non-negotiable" cost lever per PRD §17.4) can never engage if the app
/// keeps poking it. After [idleTimeout] with no interaction the cadence stops
/// entirely; [markActive] and a `resumed` lifecycle event both revive it, so
/// the user never sees stale data *while actually using the screen*.
///
/// ## Why idleness is counted in ticks, not wall-clock time
///
/// Decay is measured as "[idleTimeout] ÷ [pollInterval] consecutive ticks with
/// no interaction", which needs no clock at all. Reading `DateTime.now()` would
/// make the class untestable under `fake_async` (which fakes timers, not the
/// system clock) without also taking a `Clock` dependency — machinery this does
/// not need, since the poll timer is already the only cadence there is.
class HouseholdSyncPolicy {
  HouseholdSyncPolicy({
    required Future<void> Function() refetch,
    this.pollInterval = defaultPollInterval,
    this.idleTimeout = defaultIdleTimeout,
  })
    // Not an initializing formal: Dart forbids a named parameter beginning with
    // an underscore, and this field is private because nothing outside may swap
    // the callback after construction.
    // ignore: prefer_initializing_formals
    : _refetch = refetch;

  /// Chosen to be fast enough that a co-member's join feels near-live, and
  /// slow enough to stay cheap. Not tuned against real usage — that data does
  /// not exist yet, and this mechanism is replaced at W8 anyway.
  static const Duration defaultPollInterval = Duration(seconds: 15);

  /// How long a screen may sit untouched before the cadence gives up.
  static const Duration defaultIdleTimeout = Duration(minutes: 2);

  final Future<void> Function() _refetch;
  final Duration pollInterval;
  final Duration idleTimeout;

  Timer? _timer;
  bool _disposed = false;

  /// Guards against overlapping requests. An Aurora cold start can hold a
  /// fetch open for ~30s — far longer than [pollInterval] — and firing a
  /// second request while the first is still in flight would pile load onto
  /// exactly the instance that is already struggling.
  bool _inFlight = false;

  /// Consecutive poll ticks with no interaction. See the class doc for why
  /// idleness is counted rather than timed.
  int _idleTicks = 0;

  /// Whether the cadence is currently running.
  ///
  /// `false` covers three different situations that need no distinguishing
  /// from outside: never started, explicitly stopped, and decayed after idle.
  bool get isPolling => _timer != null;

  /// How many consecutive idle ticks end the cadence. At least one, so a
  /// misconfigured `idleTimeout < pollInterval` decays after one tick rather
  /// than never polling at all.
  int get _maxIdleTicks {
    final int ticks = idleTimeout.inMicroseconds ~/ pollInterval.inMicroseconds;
    return ticks < 1 ? 1 : ticks;
  }

  /// Enters the screen: refetch now, then poll.
  ///
  /// Safe to call repeatedly — each call is a genuine route entry and so does
  /// refetch, but the timer is replaced rather than stacked, so the cadence
  /// stays one-per-interval however many times this is called.
  void start() {
    if (_disposed) {
      return;
    }
    _idleTicks = 0;
    _restartTimer();
    _fire();
  }

  /// Leaves the screen. Idempotent.
  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Records user interaction: resets the idle countdown, reviving the cadence
  /// if it had already decayed.
  ///
  /// Deliberately does **not** refetch. Interaction means "keep this fresh",
  /// not "fetch again right now" — firing on every tap would turn a scroll into
  /// a request storm.
  void markActive() {
    if (_disposed) {
      return;
    }
    _idleTicks = 0;
    if (_timer == null) {
      _restartTimer();
    }
  }

  /// Reacts to the app moving between foreground and background.
  ///
  /// `resumed` is a refetch trigger in its own right: an app that was
  /// backgrounded for an hour is showing an hour-old roster, and that is the
  /// single most likely moment for the data on screen to be wrong.
  ///
  /// Every non-resumed state stops the cadence. A backgrounded app polling on
  /// a timer is pure waste, and on iOS the timer will not fire reliably
  /// anyway.
  void onLifecycleChanged(AppLifecycleState state) {
    if (_disposed) {
      return;
    }
    if (state == AppLifecycleState.resumed) {
      // Only revive a policy that owns a screen. A `resumed` event arriving
      // before `start()` belongs to a screen this policy is not driving yet.
      if (_hasStarted) {
        start();
      }
      return;
    }
    stop();
  }

  /// Whether [start] has ever run — distinguishes "not started" from "stopped".
  bool _hasStarted = false;

  /// Releases the timer. After this the policy is permanently inert, so a
  /// late lifecycle callback from a disposed widget cannot resurrect it.
  void dispose() {
    _disposed = true;
    stop();
  }

  void _restartTimer() {
    _hasStarted = true;
    _timer?.cancel();
    _timer = Timer.periodic(pollInterval, (Timer _) => _onTick());
  }

  void _onTick() {
    _idleTicks++;
    if (_idleTicks >= _maxIdleTicks) {
      // Decayed. `stop()` rather than a flag so `isPolling` tells the truth
      // and no timer is left burning.
      stop();
      return;
    }
    _fire();
  }

  /// Runs one refetch, swallowing whatever it throws.
  ///
  /// Swallowing is right *here* and only here: the controller behind
  /// [_refetch] already parks failures in its own `AsyncValue` where the screen
  /// renders them. Letting the error escape a `Timer` callback would reach
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
