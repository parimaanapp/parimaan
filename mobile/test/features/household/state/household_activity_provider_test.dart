import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/household_activity_provider.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/current_week.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/state/current_menu_controller.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/state/pantry_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/state/recipe_library_controller.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/fake_pantry_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/household_fixtures.dart';

final Recipe _recipe = Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Toor Dal',
  servings: 4,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: false,
  isFavorite: false,
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

final PantryItem _pantryItem = PantryItem(
  id: 'item-1',
  householdId: 'household-1',
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
  category: 'dal',
  isStaple: true,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

final Menu _emptyMenu = Menu(
  id: 'menu-1',
  householdId: 'household-1',
  weekStartDate: DateTime.utc(2026, 9, 7),
  items: const <MenuItem>[],
);

Menu _menuWithOneItem() => Menu(
  id: 'menu-1',
  householdId: 'household-1',
  weekStartDate: DateTime.utc(2026, 9, 7),
  items: <MenuItem>[
    MenuItem(
      id: 'menu-item-1',
      menuId: 'menu-1',
      recipe: _recipe,
      dayOfWeek: 0,
      mealSlot: 'lunch',
      slotRole: RecipeRole.sabziDal,
    ),
  ],
);

ProviderContainer _container({
  List<Household> households = const <Household>[],
  FakeRecipeRepository? recipeRepository,
  FakePantryRepository? pantryRepository,
  FakeMenuRepository? menuRepository,
}) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(myHouseholdsResult: households),
      ),
      recipeRepositoryProvider.overrideWithValue(
        recipeRepository ?? FakeRecipeRepository(result: const <Recipe>[]),
      ),
      pantryRepositoryProvider.overrideWithValue(
        pantryRepository ?? FakePantryRepository(result: const <PantryItem>[]),
      ),
      menuRepositoryProvider.overrideWithValue(
        menuRepository ?? FakeMenuRepository(fetchResult: _emptyMenu),
      ),
    ],
  );
  return container;
}

/// Awaits every one of `householdHasActivityProvider`'s own three sources
/// for [householdId] directly — the reliable way to get past their async
/// `build()` gap in a plain `test()` (no `flutter_test` pump loop to drive
/// it here), rather than guessing at a `Future.delayed` long enough to
/// cover all three.
Future<void> _awaitActivitySources(
  ProviderContainer container,
  String householdId,
) async {
  await container.read(recipeLibraryControllerProvider(householdId).future);
  await container.read(pantryControllerProvider(householdId).future);
  await container.read(
    currentMenuControllerProvider(
      menuKeyFor(householdId, currentWeekStartDate()),
    ).future,
  );
}

void main() {
  group('householdHasActivityProvider (W13 S6, §19.2.2 D2)', () {
    test('no households resolved yet: holds (loading), not false', () async {
      final ProviderContainer container = _container(
        households: const <Household>[],
      );
      addTearDown(container.dispose);

      // `meHouseholdsControllerProvider` starts loading; give it a beat to
      // resolve to its empty result before reading the derived provider.
      await container.read(meHouseholdsControllerProvider.future);

      final AsyncValue<bool> activity = container.read(
        householdHasActivityProvider,
      );
      expect(activity.hasValue, isTrue);
      expect(activity.value, isFalse);
    });

    test('zero recipes, pantry items and menu items resolves to false', () async {
      final ProviderContainer container = _container(
        households: <Household>[testHousehold],
        recipeRepository: FakeRecipeRepository(result: const <Recipe>[]),
        pantryRepository: FakePantryRepository(result: const <PantryItem>[]),
        menuRepository: FakeMenuRepository(fetchResult: _emptyMenu),
      );
      addTearDown(container.dispose);

      await container.read(meHouseholdsControllerProvider.future);
      await _awaitActivitySources(container, testHousehold.id);

      final AsyncValue<bool> activity = container.read(
        householdHasActivityProvider,
      );
      expect(activity.hasValue, isTrue);
      expect(activity.value, isFalse);
    });

    test('exactly one recipe (nothing else) resolves to true', () async {
      final ProviderContainer container = _container(
        households: <Household>[testHousehold],
        recipeRepository: FakeRecipeRepository(result: <Recipe>[_recipe]),
      );
      addTearDown(container.dispose);

      await container.read(meHouseholdsControllerProvider.future);
      await _awaitActivitySources(container, testHousehold.id);

      final AsyncValue<bool> activity = container.read(
        householdHasActivityProvider,
      );
      expect(activity.value, isTrue);
    });

    test('exactly one pantry item (nothing else) resolves to true', () async {
      final ProviderContainer container = _container(
        households: <Household>[testHousehold],
        pantryRepository: FakePantryRepository(result: <PantryItem>[_pantryItem]),
      );
      addTearDown(container.dispose);

      await container.read(meHouseholdsControllerProvider.future);
      await _awaitActivitySources(container, testHousehold.id);

      final AsyncValue<bool> activity = container.read(
        householdHasActivityProvider,
      );
      expect(activity.value, isTrue);
    });

    test('exactly one planned menu item (nothing else) resolves to true', () async {
      final ProviderContainer container = _container(
        households: <Household>[testHousehold],
        menuRepository: FakeMenuRepository(fetchResult: _menuWithOneItem()),
      );
      addTearDown(container.dispose);

      await container.read(meHouseholdsControllerProvider.future);
      await _awaitActivitySources(container, testHousehold.id);

      final AsyncValue<bool> activity = container.read(
        householdHasActivityProvider,
      );
      expect(activity.value, isTrue);
    });

    test(
      'a still-resolving source holds (loading), regardless of the other two',
      () async {
        final ProviderContainer container = _container(
          households: <Household>[testHousehold],
          recipeRepository: FakeRecipeRepository(
            result: <Recipe>[_recipe],
            neverCompletes: true,
          ),
        );
        addTearDown(container.dispose);

        await container.read(meHouseholdsControllerProvider.future);
        await Future<void>.delayed(Duration.zero);

        final AsyncValue<bool> activity = container.read(
          householdHasActivityProvider,
        );
        expect(
          activity.hasValue,
          isFalse,
          reason: 'a resolving source must hold, not be read as empty',
        );
      },
    );

    test(
      'an errored source holds (loading) — treated as unknown, never as '
      'empty (the OPPOSITE of how the household-existence check treats an '
      'error)',
      () async {
        final ProviderContainer container = _container(
          households: <Household>[testHousehold],
          pantryRepository: FakePantryRepository(
            error: StateError('network error'),
          ),
        );
        addTearDown(container.dispose);

        await container.read(meHouseholdsControllerProvider.future);
        // Only the two sources that actually resolve — awaiting the
        // errored pantry provider's own `.future` would rethrow here in
        // the test body itself, rather than exercising how
        // `householdHasActivityProvider` reads its error state.
        await container.read(
          recipeLibraryControllerProvider(testHousehold.id).future,
        );
        await container.read(
          currentMenuControllerProvider(
            menuKeyFor(testHousehold.id, currentWeekStartDate()),
          ).future,
        );
        // One more microtask turn for the pantry fetch's own rejection to
        // land in its `AsyncNotifier` state.
        await Future<void>.delayed(Duration.zero);

        final AsyncValue<bool> activity = container.read(
          householdHasActivityProvider,
        );
        expect(
          activity.hasValue,
          isFalse,
          reason: 'an errored source must hold, never be read as empty',
        );
      },
    );
  });
}
