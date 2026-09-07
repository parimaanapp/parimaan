import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/meal_type.dart';
import '../../state/household_wizard_controller.dart';
import 'wizard_error_copy.dart';
import 'wizard_flow.dart';
import 'wizard_step_scaffold.dart';
import 'wizard_step_submit.dart';

/// Wireframe screen 2.2 — "Which meals?", step 1/4 in the create wizard; also
/// the Settings "Meals to plan" row (`W13 S3`), reached through
/// `HouseholdEditEntry` in [WizardFlow.edit].
///
/// The create wizard renders [wizardMealTypes] — three toggleable cards,
/// Snacks deliberately not offered (see that constant's doc for why). The
/// Settings edit flow renders [editMealTypes] — all four `MealType.values`,
/// including Snacks — because [flow] is what this screen already receives to
/// tell the two contexts apart, so no second screen is needed.
class WhichMealsScreen extends ConsumerWidget {
  const WhichMealsScreen({
    super.key,
    this.flow = const WizardFlowContext.create(),
  });

  /// Whether this screen is a wizard step or a Settings edit. See
  /// `wizard_flow.dart` — defaults to the create wizard, so the wizard's own
  /// route is unchanged.
  final WizardFlowContext flow;

  static const Key continueButtonKey = Key('which-meals-continue');

  static Key toggleKey(MealType meal) => Key('which-meals-${meal.name}');

  static const String stepIndicator = '1/4';
  static const String heading = 'Which meals?';
  static const String hint = 'Toggle on the meals you plan weekly';

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

    final List<MealType> offeredMeals = flow.isEditing
        ? editMealTypes
        : wizardMealTypes;

    return WizardStepScaffold(
      stepIndicator: flow.stepIndicator(stepIndicator),
      heading: heading,
      hint: hint,
      onBack: () => context.go(
        flow.backDestination(whenCreating: AppRoutes.createHouseholdName),
      ),
      backSemanticLabel: flow.backSemanticLabel(
        whenCreating: 'Back to the household name',
      ),
      errorMessage: wizardErrorMessage(state.error),
      action: PButton(
        key: continueButtonKey,
        label: flow.actionLabel,
        isLoading: isBusy,
        expand: true,
        // `draft == null` only during the notifier's first build, which is
        // synchronous in practice; disabling rather than rendering a button
        // that would no-op is the honest state.
        onPressed: draft == null
            ? null
            : () => submitWizardStep(
                ref: ref,
                context: context,
                submit: (HouseholdWizardController c) => c.submitMealsEnabled(),
                nextRoute: flow.destination(
                  whenCreating: AppRoutes.createHouseholdStructure,
                ),
              ),
      ),
      children: <Widget>[
        for (final MealType meal in offeredMeals) ...<Widget>[
          _MealToggleCard(
            meal: meal,
            selected: draft?.mealsEnabled.contains(meal) ?? false,
            onTap: isBusy ? null : () => controller.toggleMeal(meal),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
      ],
    );
  }
}

/// One meal's card: name, description, and a tick when it is on.
///
/// A tappable [PCard] rather than a `Switch`: the design source draws a card
/// with a small check box, the whole card is the tap target, and the design
/// system has no toggle component to reach for. The tick glyph — not colour
/// alone — is what signals the state, per the components' fourth rule.
class _MealToggleCard extends StatelessWidget {
  const _MealToggleCard({
    required this.meal,
    required this.selected,
    required this.onTap,
  });

  /// The design source's own check glyph, shared with `PChip`'s selected
  /// state so one tick means one thing across the app.
  static const String selectedGlyph = PChip.selectedGlyph;

  final MealType meal;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    toggled: selected,
    child: PCard(
      key: WhichMealsScreen.toggleKey(meal),
      onTap: onTap,
      semanticLabel:
          '${meal.displayLabel}. ${meal.description}. '
          '${selected ? 'On' : 'Off'}',
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  meal.displayLabel,
                  style: AppTypography.bodyStrong.copyWith(
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: AppSpacing.s0),
                Text(
                  meal.description,
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          Text(
            selected ? selectedGlyph : '',
            style: AppTypography.bodyStrong.copyWith(
              color: AppColors.terracotta,
            ),
          ),
        ],
      ),
    ),
  );
}
