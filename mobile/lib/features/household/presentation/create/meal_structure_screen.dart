import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/meal_structure.dart';
import '../../domain/meal_type.dart';
import '../../state/household_wizard_controller.dart';
import 'slot_stepper.dart';
import 'wizard_error_copy.dart';
import 'wizard_flow.dart';
import 'wizard_step_scaffold.dart';
import 'wizard_step_submit.dart';

/// Wireframe screen 2.3 — "Lunch structure"/"Dinner structure", step 2/4 of
/// the create wizard for Lunch, or a Settings edit row for either.
///
/// Three steppers, 0–10 each, mirroring the server's own bound. Parameterised
/// by [mealType] since W13 S2 (`E2E_MVP_PLAN.md` §19.3 "S2") — before that
/// this screen only ever configured Lunch. The patch [submitMealStructure]
/// builds still carries exactly one key, now [mealType]'s rather than always
/// `lunch` — see `LunchMealStructure`'s doc for why the domain type keeps its
/// old name despite serving both meal types.
///
/// The create wizard only ever routes here with [MealType.lunch] — see
/// `router.dart`'s `AppRoutes.createHouseholdStructure` route, unchanged by
/// this slice. Dinner is reachable only from Settings, through
/// `AppRoutes.editMealStructure`'s `:mealType` segment.
class MealStructureScreen extends ConsumerWidget {
  const MealStructureScreen({
    super.key,
    required this.mealType,
    this.flow = const WizardFlowContext.create(),
  });

  /// Which meal's structure this screen edits. Only [MealType.lunch] and
  /// [MealType.dinner] are meaningful callers — Breakfast/Snacks have no
  /// structure anywhere in this system (D3, §19.2.3) — and `router.dart`'s
  /// route builder never constructs this widget with either of the other two.
  final MealType mealType;

  /// Whether this screen is a wizard step or a Settings edit. See
  /// `wizard_flow.dart` — defaults to the create wizard, so the wizard's
  /// own routes are unchanged.
  final WizardFlowContext flow;

  static const Key continueButtonKey = Key('meal-structure-continue');

  static const String stepIndicator = '2/4';
  static const String hint = 'Max slots per type — you can plan fewer any day';

  /// "Lunch structure" / "Dinner structure" — the wireframe's own heading,
  /// generalised from the meal type this instance is showing.
  String get heading => '${mealType.displayLabel} structure';

  /// The italic note under the three rows, shown only on the Lunch screen.
  ///
  /// Before W13 S2 this was a *promise* — "Dinner uses the same structure —
  /// edit separately later" — pointing at a screen that did not exist yet.
  /// Now that `AppRoutes.editMealStructure(householdId, MealType.dinner)` is
  /// a real, reachable row in Settings, the note is a cross-reference to it
  /// rather than a promise (D3, §19.2.3: "The screen's own footnote about
  /// dinner being edited separately becomes true rather than aspirational").
  /// The Dinner screen carries no equivalent note pointing back at Lunch —
  /// the wireframe never drew one, and inventing new copy for a screen the
  /// wireframe does not show is exactly the kind of unrequested addition
  /// this slice avoids.
  static const String dinnerNote =
      'Dinner has its own structure — edit it from Settings → Dinner '
      'structure.';

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
        draft?.structureFor(mealType) ?? LunchMealStructure.defaults;

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
                    c.submitMealStructure(mealType),
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
            onChanged: (int count) =>
                controller.setSlotCount(mealType, slot, count),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
        if (mealType == MealType.lunch) ...<Widget>[
          const SizedBox(height: AppSpacing.s1),
          Text(
            dinnerNote,
            style: AppTypography.label.copyWith(
              color: AppColors.inkMid,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ],
    );
  }
}

/// Rendered in place of [MealStructureScreen] when
/// `/household/:householdId/settings/meal-structure/:mealType` is reached
/// with a missing or unrecognised `:mealType` segment — a malformed deep
/// link, an old bookmark from before this route grew the segment (W13 S2), or
/// a segment naming Breakfast/Snacks, which have no structure screen at all.
///
/// Matches `router.dart`'s `_householdId` fallback discipline: an honest
/// error state with a way out, never a silent default to Lunch. Unlike
/// `_householdId`'s empty-string fallback (which lets a downstream network
/// call surface the error), an invalid meal type has no request to make —
/// there is nothing to fetch — so this screen is rendered directly by the
/// route builder instead.
class InvalidMealTypeScreen extends StatelessWidget {
  const InvalidMealTypeScreen({super.key, required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Center(
        child: PEmptyState(
          headline: 'Could not open this screen',
          body: 'This link is missing which meal to edit.',
          action: PButton(
            label: 'Back to settings',
            variant: PButtonVariant.secondary,
            onPressed: () => context.go(AppRoutes.settingsHub(householdId)),
          ),
        ),
      ),
    ),
  );
}
