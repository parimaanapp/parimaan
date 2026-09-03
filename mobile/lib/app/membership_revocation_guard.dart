import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/household/domain/household.dart';
import '../features/household/state/current_household_controller.dart';
import '../features/household/state/membership_revocation_controller.dart';

/// Watches [membershipRevocationControllerProvider] for the session's active
/// household (D7, E2E_MVP_PLAN.md §17.2.7) and calls [onRevoked] the moment
/// it flips — the router's own job is to route away (to `AppRoutes.firstRun`,
/// the same landing `settings_hub_screen.dart` sends a caller to right after
/// they delete their own household, since by the time this fires the
/// household is equally gone for this device too, just triggered by someone
/// else's action instead of this device's own).
///
/// [onRevoked] takes the guard's own [BuildContext] rather than this widget
/// importing `app/router.dart` for `AppRoutes` directly: `router.dart` is
/// what builds this widget (wrapping `AppShell` inside the `StatefulShellRoute`
/// builder), so a widget living in `router.dart` that this file imported back
/// would be circular. Taking a callback instead keeps this file free of any
/// dependency on `router.dart` — the caller supplies the destination.
///
/// Only covers whatever [child] wraps — `router.dart` wraps the four shell
/// tabs (Home/Plan/Pantry/Recipes) with this. The Settings/Members screens
/// and any shopping-list screen reached outside the shell are not wrapped.
/// An accepted, narrower scope, documented rather than silently left a
/// surprise (same style as §17.5.4/§17.5.5's own accepted gaps): those
/// screens' own live subscriptions still close on their next natural
/// teardown (screen exit, backgrounding), same as before this slice existed.
class MembershipRevocationGuard extends ConsumerWidget {
  const MembershipRevocationGuard({
    super.key,
    required this.child,
    required this.onRevoked,
  });

  final Widget child;

  /// Called once, with the guard's own [BuildContext], the moment a live
  /// `onMembershipRevoked` push lands for the active household.
  final void Function(BuildContext context) onRevoked;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);
    if (household != null) {
      ref.listen<AsyncValue<bool>>(
        membershipRevocationControllerProvider(household.id),
        (AsyncValue<bool>? previous, AsyncValue<bool> next) {
          if (next.valueOrNull == true) {
            onRevoked(context);
          }
        },
      );
    }
    return child;
  }
}
