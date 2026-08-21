import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/meal_structure.dart';
import '../../state/household_wizard_controller.dart';
import 'slot_stepper.dart';
import 'wizard_error_copy.dart';
import 'wizard_flow.dart';
import 'wizard_step_scaffold.dart';
import 'wizard_step_submit.dart';

/// Wireframe screen 2.3 — "Lunch structure", step 2/4.
///
/// Three steppers, 0–10 each, mirroring the server's own bound. Lunch only:
/// the screen's own footnote says dinner is edited separately later, and the
/// patch this builds carries exactly one `lunch` key — see
/// `LunchMealStructure`'s doc.
class MealStructureScreen extends ConsumerWidget {
  const MealStructureScreen({
    super.key,
    this.flow = const WizardFlowContext.create(),
  });

  /// Whether this screen is a wizard step or a Settings edit. See
  /// `wizard_flow.dart` — defaults to the create wizard, so the wizard's
  /// own routes are unchanged.
  final WizardFlowContext flow;

  static const Key continueButtonKey = Key('meal-structure-continue');

  static const String stepIndicator = '2/4';
  static const String heading = 'Lunch structure';
  static const String hint = 'Max slots per type — you can plan fewer any day';

  /// The italic note the wireframe draws under the three rows.
  static const String dinnerNote =
      'Dinner uses the same structure — edit separately later.';

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
    final LunchMealStructure structure =
        draft?.lunchStructure ?? LunchMealStructure.defaults;

    return WizardStepScaffold(
      stepIndicator: flow.stepIndicator(stepIndicator),
      heading: heading,
      hint: hint,
      onBack: () => context.go(
        flow.backDestination(whenCreating: AppRoutes.createHouseholdMeals),
      ),
      backSemanticLabel: flow.backSemanticLabel(
        whenCreating: 'Back to which meals to plan',
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
                    c.submitMealStructure(),
                nextRoute: flow.destination(
                  whenCreating: AppRoutes.createHouseholdCuisine,
                ),
              ),
      ),
      children: <Widget>[
        for (final MealSlot slot in MealSlot.values) ...<Widget>[
          SlotStepper(
            slot: slot,
            count: structure.countFor(slot),
            enabled: !isBusy,
            onChanged: (int count) => controller.setSlotCount(slot, count),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
        const SizedBox(height: AppSpacing.s1),
        Text(
          dinnerNote,
          style: AppTypography.label.copyWith(
            color: AppColors.inkMid,
            fontStyle: FontStyle.italic,
          ),
        ),
      ],
    );
  }
}
