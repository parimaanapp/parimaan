import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';

/// The honest stand-in for a Settings row whose screen is a later slice —
/// today, just "About Parimaan".
///
/// "Notifications" used this same shape until W8 S9 shipped the real
/// four-toggle screen (`notification_preferences_screen.dart`) — see that
/// slice for why the underlying preferences depend on FCM wiring (W20)
/// while the toggles themselves ship now. "About" still has no destination:
/// it needs version, licence and policy copy that does not exist yet.
///
/// A real route with a real [PEmptyState] rather than a disabled row or a dead
/// tap. A row that does nothing when tapped reads as a bug; one that opens a
/// screen saying "not yet" reads as a roadmap. The design system's "no dead
/// ends" rule — which is why `PEmptyState.action` is required — makes the way
/// back mandatory rather than optional.
class SettingsPlaceholderScreen extends StatelessWidget {
  const SettingsPlaceholderScreen({
    super.key,
    required this.householdId,
    required this.title,
    required this.body,
  });

  /// The Settings row this stands in for — also the top-bar title.
  final String title;

  /// One sentence on what will live here and, where it is known, when.
  final String body;

  final String householdId;

  static const Key emptyStateKey = Key('settings-placeholder');

  /// Wireframe 4.1's "About Parimaan" row.
  factory SettingsPlaceholderScreen.about({required String householdId}) =>
      SettingsPlaceholderScreen(
        householdId: householdId,
        title: 'About Parimaan',
        body: 'Version, licences and policies will be listed here.',
      );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: title,
            onBack: () => context.go(AppRoutes.settingsHub(householdId)),
            backSemanticLabel: 'Back to settings',
          ),
          Expanded(
            child: Center(
              child: PEmptyState(
                key: emptyStateKey,
                headline: 'Coming soon',
                body: body,
                action: PButton(
                  label: 'Back to settings',
                  variant: PButtonVariant.secondary,
                  onPressed: () =>
                      context.go(AppRoutes.settingsHub(householdId)),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
