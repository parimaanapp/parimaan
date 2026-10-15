import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/presentation/create/wizard_step_plan.dart';

WizardStepPlan _plan(Set<MealType> meals, {bool same = true}) =>
    WizardStepPlan(mealsEnabled: meals, dinnerSameAsLunch: same);

void main() {
  group('WizardStepPlan', () {
    test('lunch + dinner with the toggle ON is four steps', () {
      final WizardStepPlan plan = _plan(defaultMealsEnabled);

      expect(plan.steps, <WizardStep>[
        WizardStep.meals,
        WizardStep.lunchStructure,
        WizardStep.cuisine,
        WizardStep.dietary,
      ]);
      expect(plan.indicator(WizardStep.meals), '1/4');
      expect(plan.indicator(WizardStep.lunchStructure), '2/4');
      expect(plan.indicator(WizardStep.cuisine), '3/4');
      expect(plan.indicator(WizardStep.dietary), '4/4');
    });

    test('toggle OFF adds the dinner page and a fifth step', () {
      final WizardStepPlan plan = _plan(defaultMealsEnabled, same: false);

      expect(plan.hasDinnerPage, isTrue);
      expect(plan.indicator(WizardStep.dinnerStructure), '3/5');
      expect(plan.indicator(WizardStep.cuisine), '4/5');
      expect(plan.indicator(WizardStep.dietary), '5/5');
    });

    test(
      'without lunch, dinner is shown directly and no toggle is offered',
      () {
        final WizardStepPlan plan = _plan(<MealType>{
          MealType.breakfast,
          MealType.dinner,
        });

        expect(plan.hasLunchPage, isFalse);
        expect(plan.showsSameAsLunchToggle, isFalse);
        expect(plan.hasDinnerPage, isTrue);
        expect(plan.indicator(WizardStep.dinnerStructure), '2/4');
      },
    );

    test('toggle is not offered when dinner is off', () {
      final WizardStepPlan plan = _plan(<MealType>{
        MealType.lunch,
      }, same: false);

      expect(plan.showsSameAsLunchToggle, isFalse);
      expect(plan.hasDinnerPage, isFalse);
      expect(plan.total, 4);
    });

    test('neither lunch nor dinner leaves three steps', () {
      final WizardStepPlan plan = _plan(<MealType>{MealType.breakfast});

      expect(plan.total, 3);
      expect(
        plan.routeAfter(WizardStep.meals),
        AppRoutes.createHouseholdCuisine,
      );
    });

    test('persistsDinnerFromLunch only when both are on and toggle is ON', () {
      expect(_plan(defaultMealsEnabled).persistsDinnerFromLunch, isTrue);
      expect(
        _plan(defaultMealsEnabled, same: false).persistsDinnerFromLunch,
        isFalse,
      );
      expect(
        _plan(<MealType>{MealType.lunch}).persistsDinnerFromLunch,
        isFalse,
      );
    });

    test('routes chain forward and back through the dinner page', () {
      final WizardStepPlan plan = _plan(defaultMealsEnabled, same: false);

      expect(
        plan.routeAfter(WizardStep.lunchStructure),
        AppRoutes.createHouseholdDinnerStructure,
      );
      expect(
        plan.routeAfter(WizardStep.dinnerStructure),
        AppRoutes.createHouseholdCuisine,
      );
      expect(
        plan.routeBefore(WizardStep.cuisine),
        AppRoutes.createHouseholdDinnerStructure,
      );
      expect(
        plan.routeBefore(WizardStep.dinnerStructure),
        AppRoutes.createHouseholdStructure,
      );
      expect(
        plan.routeAfter(WizardStep.dietary),
        AppRoutes.createHouseholdInvite,
      );
    });

    test('back from the dinner page skips a disabled lunch', () {
      final WizardStepPlan plan = _plan(<MealType>{MealType.dinner});

      expect(
        plan.routeBefore(WizardStep.dinnerStructure),
        AppRoutes.createHouseholdMeals,
      );
    });
  });
}
