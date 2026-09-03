import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';

/// The Q14-mandated notification-permission prompt (E2E_MVP_PLAN.md §8 Q14,
/// carried forward into §17.1 row 5: "Notification-permission prompt is
/// contextual, inserted into Flow 6 at the 'Generate list · preview' screen
/// (end of W11)"). A deliberate wireframe deviation from asking during
/// onboarding — the same class of decision W10's real picker replacing W9's
/// stub already made once (§17.1's own framing), reached ONLY from the end
/// of the shopping-list generation flow ([ListPreviewScreen]'s "Done"
/// button), never from the household-creation wizard.
///
/// **What this screen actually does, and does not, call.** This codebase's
/// notification preferences (`NotificationPreferencesScreen`, W8 S9) are
/// explicitly documented as not-yet-wired to any real push: "push is W20,
/// not yet... nothing sends a push until then." There is no OS-level
/// permission-request API anywhere in this codebase yet (no
/// `permission_handler` dependency, no platform channel) for this screen to
/// call — building one now would be scope this slice does not own, and a
/// call to an OS permission dialog that gates a feature not yet built would
/// be exactly the kind of "looks wired, isn't" surface this codebase's own
/// review passes exist to catch. This screen's real job THIS week is
/// positional: it puts the ask at the right POINT in the flow (Q14's whole
/// point), and its two choices both route to the same destination — the
/// wiring to a real OS prompt is W20's own job, at which point this screen's
/// [_onEnable] is the one call site that grows it.
class NotificationPermissionPromptScreen extends StatelessWidget {
  const NotificationPermissionPromptScreen({super.key, required this.extra});

  final ShoppingListFlowExtra extra;

  static const Key enableButtonKey = Key(
    'shopping-list-notification-prompt-enable',
  );
  static const Key notNowButtonKey = Key(
    'shopping-list-notification-prompt-not-now',
  );

  void _finishFlow(BuildContext context) =>
      context.go(AppRoutes.shoppingList, extra: extra.menuId);

  @override
  Widget build(BuildContext context) => PopScope(
    // This screen has no `PTopBar`/back affordance by design — a deliberate
    // one-question stop, not a page with content to back away from. But it
    // IS still a pushed route, so hardware back / an edge swipe would
    // otherwise pop it silently, letting a user exit this flow WITHOUT
    // landing on the persistent `ShoppingListScreen` — the one route that
    // still gets them there once this screen is behind them (`flutter-reviewer`
    // finding, W11 S6 review). `canPop: false` + routing the pop through
    // the SAME `_finishFlow` both buttons use makes every exit from this
    // screen — button tap or hardware back — converge on one destination.
    canPop: false,
    onPopInvokedWithResult: (bool didPop, Object? result) {
      if (!didPop) _finishFlow(context);
    },
    child: Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Center(
          child: PEmptyState(
            headline: 'Stay on top of the list.',
            body:
                'Turn on notifications to hear about list changes from '
                'other household members.',
            action: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                PButton(
                  key: NotificationPermissionPromptScreen.enableButtonKey,
                  label: 'Turn on notifications',
                  onPressed: () => _finishFlow(context),
                ),
                const SizedBox(height: AppSpacing.s1),
                PButton(
                  key: NotificationPermissionPromptScreen.notNowButtonKey,
                  label: 'Not now',
                  variant: PButtonVariant.ghost,
                  onPressed: () => _finishFlow(context),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
