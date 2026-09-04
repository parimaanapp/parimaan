import 'dart:async';

/// The client-side deferred-commit mechanism behind "Mark as made"'s single
/// tap + undo snackbar (E2E_MVP_PLAN.md §18.2.8/D8, W12 S5).
///
/// Starting a [PendingMarkMadeAction] does **not** call the real `markMade`
/// mutation. It schedules [onCommit] behind a cancellable [Timer] set for
/// [pendingWindow] and does nothing else — no network call happens at
/// construction time. Two outcomes follow:
///
///  * [cancel] is called before [pendingWindow] elapses (the user tapped
///    Undo): the timer is cancelled and [onCommit] is **never** invoked.
///    Nothing was ever sent to the server, so there is nothing to reverse —
///    this is D8's whole point, and the reason no compensating/reversal
///    mutation exists anywhere in this codebase for `markMade`.
///  * The window elapses uninterrupted: [onCommit] fires exactly once with
///    [menuItemId]. If it succeeds, [onSuccess] is called with no arguments
///    (the caller typically has nothing left to reconcile here — the real
///    state update arrives via whatever refresh [onCommit] itself already
///    triggers). If it throws, [onError] is called with the error so the
///    caller can revert its optimistic UI and surface it — this codebase's
///    standing "never a silent no-op" rule (same as `have_it_quantity_sheet.dart`,
///    `checklist_item.dart`).
///
/// A standalone, plain-Dart `Timer` wrapper — same "independently testable
/// under `fake_async`, without also exercising Riverpod's notifier machinery"
/// reasoning `SearchDebouncer` already gives for its own existence — rather
/// than logic embedded directly in the widget or `CurrentMenuController`.
///
/// **Only one [PendingMarkMadeAction] makes sense per menu item at a time**
/// (§18.2.8's own explicit constraint). This class does not enforce that
/// itself — it has no notion of "menu item" beyond carrying [menuItemId]
/// as an opaque value passed to [onCommit] — the owning widget is
/// responsible for not starting a second one while one is already pending.
/// **Locked behaviour for a second tap while one is already pending: a
/// no-op.** The existing pending action's own window keeps running
/// unchanged — it is neither extended nor restarted. D8's own text leaves
/// this genuinely open ("use your own judgment... pick ONE clear
/// behaviour"); a no-op is chosen over "restart the window" because
/// restarting would let repeated taps defer the real commit indefinitely,
/// a stranger and less predictable outcome than "the first tap governs,"
/// and it needs no rescheduling logic on top of this class's single-`Timer`
/// shape. See `today_screen.dart`'s `_TodayItemCardState._startMarkMade`
/// for where this is enforced.
///
/// **Lifecycle scope, per §18.2.8's own accepted trade:** must survive a
/// normal foreground app lifecycle for the duration of [pendingWindow], but
/// does **not** need to survive the process being killed mid-window — if
/// that happens the tap is silently lost (never sent), matching "nothing
/// was sent" exactly rather than partially applying. Surviving "the widget
/// that owns this action leaves the tree" is the owning widget's own
/// responsibility (call [cancel] from `State.dispose`); this class does not
/// impose that on its own.
class PendingMarkMadeAction {
  PendingMarkMadeAction({
    required this.menuItemId,
    // Not an initializing formal (`this._onCommit`) — the public
    // constructor parameter is named `onCommit`, matching this class's own
    // public API, while the backing field stays private (`_onCommit`); the
    // two names deliberately differ.
    required Future<void> Function(String menuItemId) onCommit,
    required void Function(Object error) onError,
    void Function()? onSuccess,
    this.pendingWindow = defaultPendingWindow,
  }) : _onCommit = onCommit, // ignore: prefer_initializing_formals
       _onSuccess = onSuccess ?? _noop, // ignore: prefer_initializing_formals
       // ignore: prefer_initializing_formals
       _onError = onError {
    _timer = Timer(pendingWindow, _fire);
  }

  static void _noop() {}

  /// Matched to the undo snackbar's own visible duration (D8's own design:
  /// "`pendingWindow` matched to the snackbar's own visible duration") —
  /// `today_screen.dart` passes this same value to `PToast.show`'s
  /// `duration` for the "Marked as made · Undo" snackbar, so the window a
  /// user has to tap Undo is exactly as long as the snackbar stays visible.
  static const Duration defaultPendingWindow = Duration(seconds: 4);

  /// The `MenuItem.id` [onCommit] is eventually called with.
  final String menuItemId;

  final Duration pendingWindow;
  final Future<void> Function(String menuItemId) _onCommit;
  final void Function() _onSuccess;
  final void Function(Object error) _onError;

  late final Timer _timer;

  bool _cancelled = false;
  bool _committed = false;

  /// `true` once [cancel] has been called. A cancelled action never fires
  /// [onCommit], even if the timer had already elapsed in the same event
  /// loop turn — [cancel] and [_fire] both check this flag first.
  bool get isCancelled => _cancelled;

  /// `true` once the deferred [onCommit] has actually been invoked — the
  /// window elapsed uninterrupted. Set before [onCommit] is awaited (not
  /// after it resolves), matching "the mutation only fires once the undo
  /// window elapses" — this reflects that the send happened, independent of
  /// whether it ultimately succeeded or failed.
  bool get isCommitted => _committed;

  Future<void> _fire() async {
    if (_cancelled) return;
    _committed = true;
    try {
      await _onCommit(menuItemId);
      _onSuccess();
    } catch (error) {
      _onError(error);
    }
  }

  /// Cancels the pending timer. Guaranteed, once this returns, that
  /// [onCommit] will never run for this action — matching D8's "nothing was
  /// ever sent to the server" contract for Undo. A no-op if already
  /// cancelled or already committed (calling it after the window elapsed
  /// does not un-send an already-sent mutation — there is nothing left to
  /// cancel by then).
  void cancel() {
    if (_committed) return;
    _cancelled = true;
    _timer.cancel();
  }
}
