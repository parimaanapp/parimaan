import 'dart:async';

/// Coalesces rapid [update] calls into one [onSettled] call after [duration]
/// of quiet — so a search box tied to `Query.pantry` doesn't fire a network
/// request per keystroke against a database that can take up to ~30s to
/// resume from Aurora auto-pause.
///
/// A standalone, plain-Dart Timer wrapper rather than logic embedded in
/// `PantryController` directly, for the same reason `HouseholdSyncPolicy` is
/// its own class: it is independently testable under `fake_async` without
/// also exercising Riverpod's notifier machinery, and a debounced-typing
/// concern is generic enough that a future search field (recipes, W6) can
/// reuse it rather than re-deriving the same Timer-cancel-and-replace logic.
class SearchDebouncer {
  SearchDebouncer({required this.onSettled, this.duration = defaultDuration});

  /// Chosen to be short enough that typing still feels responsive and long
  /// enough to coalesce a normal typing burst into one request. Not tuned
  /// against real usage — no such data exists yet.
  static const Duration defaultDuration = Duration(milliseconds: 400);

  /// Called once, [duration] after the *last* [update] call, with that
  /// call's own value.
  final void Function(String? value) onSettled;
  final Duration duration;

  Timer? _timer;

  /// Records a new value, restarting the countdown. Call on every keystroke.
  void update(String? value) {
    _timer?.cancel();
    _timer = Timer(duration, () => onSettled(value));
  }

  /// Cancels any pending settle. Idempotent — safe to call whether or not a
  /// timer is currently running.
  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}
