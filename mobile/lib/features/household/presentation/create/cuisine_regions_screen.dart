import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/cuisine_taxonomy.dart';
import '../../state/household_wizard_controller.dart';
import 'wizard_error_copy.dart';
import 'wizard_flow.dart';
import 'wizard_step_scaffold.dart';
import 'wizard_step_submit.dart';

/// Wireframe screen 2.4 — "Cuisine mix", step 3/4 (first of two frames).
///
/// Filter chips over the five `CuisineTier1` values. The wireframe draws a
/// sixth, **East**, which is not a schema enum value and therefore has no chip
/// here — see `CuisineRegion`'s doc for the full reasoning.
class CuisineRegionsScreen extends ConsumerWidget {
  const CuisineRegionsScreen({
    super.key,
    this.flow = const WizardFlowContext.create(),
  });

  /// Whether this screen is a wizard step or a Settings edit. See
  /// `wizard_flow.dart` — defaults to the create wizard, so the wizard's
  /// own routes are unchanged.
  final WizardFlowContext flow;

  static const Key continueButtonKey = Key('cuisine-regions-continue');

  static Key chipKey(CuisineRegion region) =>
      Key('cuisine-region-${region.name}');

  static const String stepIndicator = '3/4';
  static const String heading = 'Cuisine mix';
  static const String hint = 'Broad regions your household eats';

  /// The forward-pointing note the wireframe draws under the chips.
  static const String unlockNote = 'Sub-cuisines unlock next →';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<HouseholdWizardData> state = ref.watch(
      householdWizardControllerProvider,
    );
    final HouseholdWizardData? draft = state.valueOrNull;
    final HouseholdWizardController controller = ref.read(
      householdWizardControllerProvider.notifier,
    );
    final bool isBusy = state.isLoading;

    return WizardStepScaffold(
      stepIndicator: flow.stepIndicator(stepIndicator),
      heading: heading,
      hint: hint,
      onBack: () => context.go(
        flow.backDestination(whenCreating: AppRoutes.createHouseholdStructure),
      ),
      backSemanticLabel: flow.backSemanticLabel(
        whenCreating: 'Back to the lunch structure',
      ),
      errorMessage: wizardErrorMessage(state.error),
      action: PButton(
        key: continueButtonKey,
        label: flow.actionLabel,
        isLoading: isBusy,
        expand: true,
        onPressed: draft == null
            ? null
            : () => submitWizardStep(
                ref: ref,
                context: context,
                submit: (HouseholdWizardController c) =>
                    c.submitCuisineRegions(),
                nextRoute: flow.destination(
                  whenCreating: AppRoutes.createHouseholdCuisineBias,
                ),
              ),
      ),
      children: <Widget>[
        Wrap(
          spacing: AppSpacing.s1,
          runSpacing: AppSpacing.s1,
          children: <Widget>[
            for (final CuisineRegion region in CuisineRegion.values)
              PChip(
                key: chipKey(region),
                label: region.displayLabel,
                selected: draft?.regions.contains(region) ?? false,
                onTap: isBusy ? null : () => controller.toggleRegion(region),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.s3),
        Text(
          unlockNote,
          style: AppTypography.label.copyWith(color: AppColors.inkMid),
        ),
      ],
    );
  }
}
