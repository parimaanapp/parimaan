import '../../../../app/router.dart';
import '../../domain/meal_type.dart';
import '../../state/household_wizard_data.dart';

/// One page of the create wizard that carries a step number.
///
/// The sub-cuisine bias frame shares [cuisine]'s number, as before.
enum WizardStep { meals, lunchStructure, dinnerStructure, cuisine, dietary }

/// Which pages the create wizard shows for the current answers, and so what
/// the "n/total" counter, Continue and Back should be.
///
/// Pure value: derived from the meals the household enabled and the "Same
/// structure as lunch" toggle (A7, `E2E_MVP_PLAN.md` §32 #3). Every screen
/// builds one from the draft, so the counter and the navigation can never
/// disagree about which pages exist.
///
///  * Lunch page — shown when lunch is enabled.
///  * Dinner page — shown when dinner is enabled and either lunch is off
///    (nothing to be "the same as") or the toggle is OFF.
class WizardStepPlan {
  const WizardStepPlan({
    required this.mealsEnabled,
    this.dinnerSameAsLunch = true,
  });

  /// The plan for [draft]; the defaults while the draft has not built yet.
  factory WizardStepPlan.fromDraft(HouseholdWizardData? draft) =>
      WizardStepPlan(
        mealsEnabled: draft?.mealsEnabled ?? defaultMealsEnabled,
        dinnerSameAsLunch: draft?.dinnerSameAsLunch ?? true,
      );

  final Set<MealType> mealsEnabled;
  final bool dinnerSameAsLunch;

  bool get hasLunchPage => mealsEnabled.contains(MealType.lunch);

  bool get _dinnerEnabled => mealsEnabled.contains(MealType.dinner);

  /// The toggle row only means something with both lunch and dinner on.
  bool get showsSameAsLunchToggle => hasLunchPage && _dinnerEnabled;

  bool get hasDinnerPage =>
      _dinnerEnabled && (!hasLunchPage || !dinnerSameAsLunch);

  /// True when continuing from the lunch page must also write dinner = lunch.
  bool get persistsDinnerFromLunch =>
      showsSameAsLunchToggle && dinnerSameAsLunch;

  List<WizardStep> get steps => <WizardStep>[
    WizardStep.meals,
    if (hasLunchPage) WizardStep.lunchStructure,
    if (hasDinnerPage) WizardStep.dinnerStructure,
    WizardStep.cuisine,
    WizardStep.dietary,
  ];

  int get total => steps.length;

  /// "2/4"-style counter for [step].
  String indicator(WizardStep step) => '${steps.indexOf(step) + 1}/$total';

  static String _routeFor(WizardStep step) => switch (step) {
    WizardStep.meals => AppRoutes.createHouseholdMeals,
    WizardStep.lunchStructure => AppRoutes.createHouseholdStructure,
    WizardStep.dinnerStructure => AppRoutes.createHouseholdDinnerStructure,
    WizardStep.cuisine => AppRoutes.createHouseholdCuisine,
    WizardStep.dietary => AppRoutes.createHouseholdDietary,
  };

  /// Where Continue from [step] goes.
  String routeAfter(WizardStep step) {
    final List<WizardStep> all = steps;
    final int next = all.indexOf(step) + 1;
    return next >= all.length
        ? AppRoutes.createHouseholdInvite
        : _routeFor(all[next]);
  }

  /// Screen-reader label for Back from [step], naming where it goes.
  String backSemanticLabel(WizardStep step) {
    final List<WizardStep> all = steps;
    final int previous = all.indexOf(step) - 1;
    if (previous < 0) return 'Back to the household name';
    return switch (all[previous]) {
      WizardStep.meals => 'Back to which meals to plan',
      WizardStep.lunchStructure => 'Back to the lunch structure',
      WizardStep.dinnerStructure => 'Back to the dinner structure',
      WizardStep.cuisine => 'Back to the cuisine regions',
      WizardStep.dietary => 'Back to the dietary step',
    };
  }

  /// Where Back from [step] goes.
  String routeBefore(WizardStep step) {
    final List<WizardStep> all = steps;
    final int previous = all.indexOf(step) - 1;
    return previous < 0
        ? AppRoutes.createHouseholdName
        : _routeFor(all[previous]);
  }
}
