import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/current_household_controller.dart';
import '../../state/household_sync_policy.dart';

/// Binds a [HouseholdSyncPolicy] to the lifetime of a household-scoped screen.
///
/// Wraps its [child] and does three things while it is mounted:
///
///  * `start()`s the policy on mount — the refetch-on-route-entry trigger.
///  * Forwards `AppLifecycleState` changes, so foregrounding refetches.
///  * Reports user interaction, so the poll does not decay under someone's
///    finger.
///
/// Everything about *cadence* lives in `HouseholdSyncPolicy`; this widget only
/// supplies the three signals a plain Dart class cannot see for itself. Keeping
/// the policy free of Flutter (beyond the `AppLifecycleState` enum) is what
/// lets its whole cadence be tested under `fake_async` with no widget tree.
///
/// The interaction signal is a [Listener] on the pointer-down phase rather than
/// a `GestureDetector`: pointer-down never competes in the gesture arena, so
/// wrapping a screen in this can never swallow a tap meant for a button
/// underneath it.
class HouseholdSyncScope extends ConsumerStatefulWidget {
  const HouseholdSyncScope({
    super.key,
    required this.householdId,
    required this.child,
  });

  final String householdId;
  final Widget child;

  @override
  ConsumerState<HouseholdSyncScope> createState() => _HouseholdSyncScopeState();
}

class _HouseholdSyncScopeState extends ConsumerState<HouseholdSyncScope>
    with WidgetsBindingObserver {
  late final HouseholdSyncPolicy _policy;

  @override
  void initState() {
    super.initState();
    _policy = HouseholdSyncPolicy(refetch: _refetch);
    WidgetsBinding.instance.addObserver(this);
    _policy.start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _policy.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      _policy.onLifecycleChanged(state);

  /// Re-reads the household this scope is keyed on.
  ///
  /// `refresh()` never throws (its own contract), which matters here because
  /// this runs from a `Timer` where an escaping exception would surface as an
  /// unhandled async error rather than as anything the user could act on.
  Future<void> _refetch() => ref
      .read(currentHouseholdControllerProvider(widget.householdId).notifier)
      .refresh();

  @override
  Widget build(BuildContext context) => Listener(
    onPointerDown: (PointerDownEvent _) => _policy.markActive(),
    child: widget.child,
  );
}
