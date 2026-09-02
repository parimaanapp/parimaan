import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';

/// The Home tab of [AppShell].
///
/// Minimal by design — this is W5's nav-shell slice, not the real Home
/// screen (a later week's work). What it carries over from the placeholder
/// it replaces is the one affordance that mattered: reaching Settings when a
/// household exists. See `router.dart`'s former `_HomePlaceholderScreen` doc
/// for the history; this file is that widget's replacement, not a growth of
/// it — nothing here should be extended without checking whether the real
/// Home screen slice should own it instead.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  static const Key settingsButtonKey = Key('home-settings');

  /// The one exception to this file's own "nothing extends without
  /// checking" rule (W9 S5): the Weekly plan screen needs SOME reachable
  /// entry point today, and S6's own doc explicitly defers the real
  /// Home-tab/tab-bar IA decision rather than locking it here — this button
  /// is the same kind of interim affordance [settingsButtonKey] already is,
  /// not a preemption of that later call.
  static const Key weeklyPlanButtonKey = Key('home-weekly-plan');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const Text('Signed in'),
                if (household != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.s3),
                  PButton(
                    key: settingsButtonKey,
                    label: 'Household settings',
                    variant: PButtonVariant.secondary,
                    onPressed: () =>
                        context.go(AppRoutes.settingsHub(household.id)),
                  ),
                  const SizedBox(height: AppSpacing.s2),
                  PButton(
                    key: weeklyPlanButtonKey,
                    label: 'Weekly plan',
                    variant: PButtonVariant.primary,
                    onPressed: () => context.push(AppRoutes.weeklyPlan),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
