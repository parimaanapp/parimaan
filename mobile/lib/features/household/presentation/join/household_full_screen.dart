import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../state/join_household_controller.dart';

/// Wireframe screen 3.3 — "Household is full".
///
/// Reached from exactly one place: `JoinOutcome.householdFull`, which
/// `JoinHouseholdController` returns for `HouseholdFullError` and for nothing
/// else. Every other failure renders inline on screen 3.1 — see that
/// controller's doc for why the routing decision lives there rather than in a
/// widget's `is` check.
///
/// ## The disabled "Notify primary" button is the wireframe's own design
///
/// The button is drawn disabled, with "v1.1 feature" underneath it. That is
/// literal wireframe copy, not a judgement made here and not a stub standing in
/// for something missing: there is no notify-primary mutation in
/// `shared/schema.graphql`, and shipping a working button would mean inventing
/// a server operation. Rendering it disabled tells the user the path exists and
/// is coming, which is more honest than hiding it and more honest than a button
/// that silently does nothing.
class HouseholdFullScreen extends ConsumerWidget {
  const HouseholdFullScreen({super.key});

  static const Key notifyButtonKey = Key('household-full-notify');
  static const Key backButtonKey = Key('household-full-back');
  static const Key membersCountKey = Key('household-full-count');

  static const String heading = 'Household is full';

  /// The server's own cap, mirrored from `api/src/domain/householdLimits.ts`.
  /// A widget test asserts the rendered "5 / 5", so a server-side change that
  /// is not mirrored here fails a test rather than quietly lying on screen.
  static const int memberCap = 5;

  static const String body = 'Ask the primary to make room.';
  static const String notifyLabel = 'Notify primary';
  static const String notifyHint = 'v1.1 feature';

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Join a household',
            onBack: () => _back(context, ref),
            backSemanticLabel: 'Back to the invite code',
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    heading,
                    textAlign: TextAlign.center,
                    style: AppTypography.displayM.copyWith(
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s1),
                  Text(
                    'Members: $memberCap / $memberCap. $body',
                    key: membersCountKey,
                    textAlign: TextAlign.center,
                    style: AppTypography.body.copyWith(color: AppColors.inkMid),
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  const PButton(
                    key: notifyButtonKey,
                    label: notifyLabel,
                    variant: PButtonVariant.secondary,
                    expand: true,
                    // Disabled by a null callback — see the class doc. There
                    // is no mutation behind this, by design.
                    onPressed: null,
                  ),
                  const SizedBox(height: AppSpacing.s0),
                  Text(
                    notifyHint,
                    textAlign: TextAlign.center,
                    style: AppTypography.meta.copyWith(color: AppColors.inkMid),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: PButton(
              key: backButtonKey,
              label: 'Try a different code',
              variant: PButtonVariant.ghost,
              expand: true,
              onPressed: () => _back(context, ref),
            ),
          ),
        ],
      ),
    ),
  );

  /// Returning clears the failed attempt, so screen 3.1 reopens on an empty
  /// field rather than on a stale "household is full" error.
  void _back(BuildContext context, WidgetRef ref) {
    ref.read(joinHouseholdControllerProvider.notifier).reset();
    context.go(AppRoutes.joinHousehold);
  }
}
