import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/current_household_controller.dart';
import '../../state/household_sync_policy.dart';

/// Binds a [HouseholdSyncPolicy] to the lifetime of a household-scoped screen.
///
/// Wraps its [child] and does two things while it is mounted:
///
///  * `start()`s the policy on mount — the refetch-on-route-entry trigger.
///  * Forwards `AppLifecycleState` changes, so foregrounding refetches.
///
/// A live `onHouseholdChanged` push (W8 S10) is what keeps the roster fresh
/// while this screen stays mounted — `CurrentHouseholdController` subscribes
/// to that directly, independent of this widget. This scope's own job is
/// narrower now than it was pre-W8 S10 (when it also tracked pointer-down
/// interaction to revive an idle-decaying poll): with no poll left,
/// `HouseholdSyncPolicy` has no idle cadence to keep alive, so there is no
/// third signal for this widget to supply.
///
/// Everything about *when* a refetch fires lives in `HouseholdSyncPolicy`;
/// this widget only supplies the two signals a plain Dart class cannot see
/// for itself. Keeping the policy free of Flutter (beyond the
/// `AppLifecycleState` enum) is what lets it be tested with no widget tree.
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
  /// this can run from a lifecycle callback where an escaping exception
  /// would surface as an unhandled async error rather than as anything the
  /// user could act on.
  Future<void> _refetch() => ref
      .read(currentHouseholdControllerProvider(widget.householdId).notifier)
      .refresh();

  @override
  Widget build(BuildContext context) => widget.child;
}
