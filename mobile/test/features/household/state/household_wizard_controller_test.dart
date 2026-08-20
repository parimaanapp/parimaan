import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';
import 'package:mobile/features/household/domain/dietary_tag.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

ProviderContainer _container(FakeHouseholdRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// A container whose wizard already holds a created household — the state
/// every screen after 2.1 runs in.
Future<
  ({
    ProviderContainer container,
    FakeHouseholdRepository repository,
    HouseholdWizardController controller,
  })
>
_started() async {
  final FakeHouseholdRepository repository = FakeHouseholdRepository(
    result: testHousehold,
    settingsResult: testHouseholdSettings,
  );
  final ProviderContainer container = _container(repository);
  await container.read(householdWizardControllerProvider.future);
  final HouseholdWizardController controller = container.read(
    householdWizardControllerProvider.notifier,
  );
  controller.adoptHousehold(testHousehold);
  return (container: container, repository: repository, controller: controller);
}

HouseholdWizardData _data(ProviderContainer container) =>
    container.read(householdWizardControllerProvider).requireValue;

void main() {
  group('HouseholdWizardController — initial draft', () {
    test('starts with no household and the wireframe defaults', () async {
      final ProviderContainer container = _container(
        FakeHouseholdRepository(result: testHousehold),
      );

      final HouseholdWizardData data = await container.read(
        householdWizardControllerProvider.future,
      );

      expect(data.household, isNull);
      expect(data.householdId, isNull);
      expect(data.mealsEnabled, defaultMealsEnabled);
      expect(data.lunchStructure, LunchMealStructure.defaults);
      expect(data.regions, defaultCuisineRegions);
      expect(data.dietaryTags, defaultDietaryTags);
      expect(data.allergens, isEmpty);
      expect(data.skipIngredients, isEmpty);
    });

    test(
      'sub-cuisine biases default to normal for the default regions',
      () async {
        final ProviderContainer container = _container(
          FakeHouseholdRepository(result: testHousehold),
        );

        final HouseholdWizardData data = await container.read(
          householdWizardControllerProvider.future,
        );

        expect(data.subCuisineWeights.keys, contains('punjabi'));
        expect(data.subCuisineWeights.values, everyElement(CuisineBias.normal));
      },
    );

    test('does not touch the repository just by being built', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
      );
      final ProviderContainer container = _container(repository);

      await container.read(householdWizardControllerProvider.future);

      expect(repository.calls, isEmpty);
      expect(repository.settingsCalls, isEmpty);
    });
  });

  group('HouseholdWizardController.adoptHousehold', () {
    test('takes ownership of the household created on screen 2.1', () async {
      final subject = await _started();

      expect(_data(subject.container).household, testHousehold);
      expect(_data(subject.container).householdId, 'household-1');
      expect(_data(subject.container).inviteCode, 'ABC123');
    });
  });

  group('HouseholdWizardController — local draft edits', () {
    test(
      'toggleMeal turns a meal off and back on without a round trip',
      () async {
        final subject = await _started();

        subject.controller.toggleMeal(MealType.breakfast);
        expect(
          _data(subject.container).mealsEnabled,
          isNot(contains(MealType.breakfast)),
        );

        subject.controller.toggleMeal(MealType.breakfast);
        expect(
          _data(subject.container).mealsEnabled,
          contains(MealType.breakfast),
        );

        expect(subject.repository.settingsCalls, isEmpty);
      },
    );

    test('setSlotCount clamps to the server bounds', () async {
      final subject = await _started();

      subject.controller.setSlotCount(MealSlot.carb, 99);
      expect(
        _data(subject.container).lunchStructure.countFor(MealSlot.carb),
        10,
      );

      subject.controller.setSlotCount(MealSlot.carb, -1);
      expect(
        _data(subject.container).lunchStructure.countFor(MealSlot.carb),
        0,
      );
    });

    test('toggling a region re-derives the sub-cuisine weight map', () async {
      final subject = await _started();

      subject.controller.toggleRegion(CuisineRegion.northIndian);

      expect(
        _data(subject.container).regions,
        isNot(contains(CuisineRegion.northIndian)),
      );
      expect(
        _data(subject.container).subCuisineWeights.keys,
        isNot(contains('punjabi')),
      );
      expect(
        _data(subject.container).subCuisineWeights.keys,
        contains('tamil'),
      );
    });

    test('re-selecting a region restores its sub-cuisines at normal', () async {
      final subject = await _started();

      subject.controller.setBias('punjabi', CuisineBias.more);
      subject.controller.toggleRegion(CuisineRegion.northIndian);
      subject.controller.toggleRegion(CuisineRegion.northIndian);

      expect(
        _data(subject.container).subCuisineWeights['punjabi'],
        CuisineBias.normal,
      );
    });

    test(
      'setBias records one sub-cuisine without disturbing the rest',
      () async {
        final subject = await _started();

        subject.controller.setBias('punjabi', CuisineBias.more);

        expect(
          _data(subject.container).subCuisineWeights['punjabi'],
          CuisineBias.more,
        );
        expect(
          _data(subject.container).subCuisineWeights['marathi'],
          CuisineBias.normal,
        );
      },
    );

    test(
      'allergens can be added, de-duplicated, trimmed and removed',
      () async {
        final subject = await _started();

        subject.controller.addAllergen('  peanut ');
        subject.controller.addAllergen('peanut');
        subject.controller.addAllergen('sesame');
        expect(_data(subject.container).allergens, <String>[
          'peanut',
          'sesame',
        ]);

        subject.controller.removeAllergen('peanut');
        expect(_data(subject.container).allergens, <String>['sesame']);
      },
    );

    test('a blank allergen is ignored rather than stored', () async {
      final subject = await _started();

      subject.controller.addAllergen('   ');

      expect(_data(subject.container).allergens, isEmpty);
    });

    test('skip ingredients behave the same way', () async {
      final subject = await _started();

      subject.controller.addSkipIngredient('mustard oil');
      subject.controller.addSkipIngredient('mustard oil');
      expect(_data(subject.container).skipIngredients, <String>['mustard oil']);

      subject.controller.removeSkipIngredient('mustard oil');
      expect(_data(subject.container).skipIngredients, isEmpty);
    });

    test('toggleDietaryTag flips one chip', () async {
      final subject = await _started();

      subject.controller.toggleDietaryTag(DietaryTag.vegan);

      expect(_data(subject.container).dietaryTags, contains(DietaryTag.vegan));
      expect(_data(subject.container).dietaryTags, contains(DietaryTag.veg));
    });
  });

  group('HouseholdWizardController — one patch per step', () {
    test('submitMealsEnabled sends only mealsEnabled', () async {
      final subject = await _started();

      await subject.controller.submitMealsEnabled();

      expect(subject.repository.settingsCalls, hasLength(1));
      final HouseholdSettingsPatch patch =
          subject.repository.settingsCalls.single.patch;
      expect(
        subject.repository.settingsCalls.single.householdId,
        'household-1',
      );
      expect(patch.fieldCount, 1);
      expect(patch.mealsEnabled, <MealType>[
        MealType.breakfast,
        MealType.lunch,
        MealType.dinner,
      ]);
    });

    test(
      'submitMealStructure sends only the lunch-keyed mealStructure',
      () async {
        final subject = await _started();
        subject.controller.setSlotCount(MealSlot.carb, 3);

        await subject.controller.submitMealStructure();

        final HouseholdSettingsPatch patch =
            subject.repository.settingsCalls.single.patch;
        expect(patch.fieldCount, 1);
        expect(
          patch.mealStructureJson,
          '{"lunch":{"carb":3,"sabzi_dal":2,"accompaniment":1}}',
        );
      },
    );

    test('submitCuisineRegions sends only cuisineTier1', () async {
      final subject = await _started();

      await subject.controller.submitCuisineRegions();

      final HouseholdSettingsPatch patch =
          subject.repository.settingsCalls.single.patch;
      expect(patch.fieldCount, 1);
      expect(patch.cuisineTier1, <CuisineRegion>[
        CuisineRegion.northIndian,
        CuisineRegion.southIndian,
        CuisineRegion.panIndia,
      ]);
    });

    test('submitCuisineSubAndBias sends only cuisineTier2Weights, using the '
        'server "normal" spelling', () async {
      final subject = await _started();
      subject.controller.setBias('punjabi', CuisineBias.more);

      await subject.controller.submitCuisineSubAndBias();

      final HouseholdSettingsPatch patch =
          subject.repository.settingsCalls.single.patch;
      expect(patch.fieldCount, 1);
      expect(patch.cuisineTier2WeightsJson, contains('"punjabi":"more"'));
      expect(patch.cuisineTier2WeightsJson, contains('"marathi":"normal"'));
      expect(patch.cuisineTier2WeightsJson, isNot(contains('same')));
    });

    test('submitDietaryAndAllergens sends the three fields that step '
        'owns', () async {
      final subject = await _started();
      subject.controller.addAllergen('peanut');
      subject.controller.addSkipIngredient('mustard oil');

      await subject.controller.submitDietaryAndAllergens();

      final HouseholdSettingsPatch patch =
          subject.repository.settingsCalls.single.patch;
      expect(patch.fieldCount, 3);
      expect(patch.dietaryTags, <DietaryTag>[
        DietaryTag.veg,
        DietaryTag.eggetarian,
      ]);
      expect(patch.allergens, <String>['peanut']);
      expect(patch.skipIngredients, <String>['mustard oil']);
    });
  });

  group('HouseholdWizardController — async state', () {
    test('goes loading then data on success, keeping the draft visible '
        'throughout', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
        settingsResult: testHouseholdSettings,
        delay: const Duration(milliseconds: 10),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdWizardControllerProvider.future);
      container
          .read(householdWizardControllerProvider.notifier)
          .adoptHousehold(testHousehold);

      final List<AsyncValue<HouseholdWizardData>> observed =
          <AsyncValue<HouseholdWizardData>>[];
      container.listen<AsyncValue<HouseholdWizardData>>(
        householdWizardControllerProvider,
        (
          AsyncValue<HouseholdWizardData>? _,
          AsyncValue<HouseholdWizardData> next,
        ) => observed.add(next),
      );

      await container
          .read(householdWizardControllerProvider.notifier)
          .submitMealsEnabled();

      expect(observed.first.isLoading, isTrue);
      // The draft survives the spinner — the screen keeps rendering its
      // toggles rather than blanking out.
      expect(observed.first.valueOrNull, isNotNull);
      expect(observed.last.isLoading, isFalse);
      expect(observed.last.hasError, isFalse);
    });

    test('never throws — an AppError lands in state with its concrete type '
        'intact', () async {
      final subject = await _started();
      subject.repository.settingsError = const ForbiddenError('not a member');

      await subject.controller.submitMealsEnabled();

      final AsyncValue<HouseholdWizardData> state = subject.container.read(
        householdWizardControllerProvider,
      );
      expect(state.hasError, isTrue);
      expect(state.error, isA<ForbiddenError>());
      expect((state.error! as ForbiddenError).errorMessage, 'not a member');
    });

    test('the draft is still readable after a failure, so the user can '
        'retry without re-entering anything', () async {
      final subject = await _started();
      subject.controller.setSlotCount(MealSlot.carb, 7);
      subject.repository.settingsError = const RateLimitedError('slow down');

      await subject.controller.submitMealStructure();

      final AsyncValue<HouseholdWizardData> state = subject.container.read(
        householdWizardControllerProvider,
      );
      expect(state.hasError, isTrue);
      expect(state.valueOrNull?.lunchStructure.countFor(MealSlot.carb), 7);
    });

    test('a successful retry clears the earlier error', () async {
      final subject = await _started();
      subject.repository.settingsError = const InternalError('boom');
      await subject.controller.submitMealsEnabled();
      expect(
        subject.container.read(householdWizardControllerProvider).hasError,
        isTrue,
      );

      subject.repository.settingsError = null;
      await subject.controller.submitMealsEnabled();

      expect(
        subject.container.read(householdWizardControllerProvider).hasError,
        isFalse,
      );
      expect(subject.repository.settingsCalls, hasLength(2));
    });

    test('editing the draft clears a stale error message', () async {
      final subject = await _started();
      subject.repository.settingsError = const InternalError('boom');
      await subject.controller.submitMealsEnabled();

      subject.controller.toggleMeal(MealType.lunch);

      expect(
        subject.container.read(householdWizardControllerProvider).hasError,
        isFalse,
      );
    });

    test('submitting before a household exists is an InternalError, not a '
        'crash and not a request', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
        settingsResult: testHouseholdSettings,
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdWizardControllerProvider.future);

      await container
          .read(householdWizardControllerProvider.notifier)
          .submitMealsEnabled();

      expect(repository.settingsCalls, isEmpty);
      expect(
        container.read(householdWizardControllerProvider).error,
        isA<InternalError>(),
      );
    });
  });
}
