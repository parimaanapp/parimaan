import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';

import 'fake_menu_repository.dart';
import 'fake_pantry_repository.dart';
import 'fake_recipe_repository.dart';

/// One fixture [Recipe], for any override below that needs a non-empty
/// recipe library.
Recipe _activityRecipe(String householdId) => Recipe(
  id: 'activity-recipe-1',
  householdId: householdId,
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

/// One fixture [PantryItem], for any override below that needs a non-empty
/// pantry.
PantryItem _activityPantryItem(String householdId) => PantryItem(
  id: 'activity-pantry-1',
  householdId: householdId,
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
  category: 'dal',
  isStaple: true,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

/// One fixture [Menu] carrying a single planned [MenuItem], for any
/// override below that needs a non-empty current week.
Menu _activityMenuWithItem(String householdId) => Menu(
  id: 'activity-menu-1',
  householdId: householdId,
  weekStartDate: DateTime.utc(2026, 9, 7),
  mealConfigSnapshot: '{}',
  items: <MenuItem>[
    MenuItem(
      id: 'activity-menu-item-1',
      menuId: 'activity-menu-1',
      recipe: Recipe(
        id: 'activity-recipe-2',
        householdId: householdId,
        sourceType: RecipeSource.user,
        title: 'Rajma',
        servings: 4,
        dietaryTags: const <String>[],
        role: RecipeRole.sabziDal,
        inRotation: true,
        isFavorite: false,
        steps: const <String>['Soak overnight', 'Pressure cook'],
        createdAt: DateTime.utc(2026, 9, 1),
        updatedAt: DateTime.utc(2026, 9, 1),
      ),
      dayOfWeek: 0,
      mealSlot: 'lunch',
      slotRole: RecipeRole.sabziDal,
    ),
  ],
);

/// The empty [Menu] a fresh household's current week get-or-creates to.
Menu _emptyActivityMenu(String householdId) => Menu(
  id: 'activity-menu-1',
  householdId: householdId,
  weekStartDate: DateTime.utc(2026, 9, 7),
  mealConfigSnapshot: '{}',
  items: const <MenuItem>[],
);

/// Default overrides for the three sources `householdHasActivityProvider`
/// reads (W13 S6, §19.2.2 D2) — every test that boots the **real** router
/// (`router_test.dart`'s `_pumpRouter`, `household_route_harness.dart`'s
/// `pumpHouseholdRoute`, `membership_revocation_router_test.dart`'s own
/// helper) now has `_redirect` read `recipeLibraryControllerProvider`,
/// `pantryControllerProvider` and `currentMenuControllerProvider` for any
/// household it lands a signed-in user on from splash/sign-in — none of
/// which any of those pre-W13-S6 harnesses configured, because nothing
/// read them from the redirect guard before this slice.
///
/// Left unconfigured, those three providers fall through to their real,
/// network-backed repositories (`ferryClientProvider`'s real `Client`),
/// which is unsafe in a widget test regardless of whether the eventual
/// assertion even cares about `/welcome` vs. `/home` — a test whose harness
/// lands a household on splash still has to survive the `pumpAndSettle()`
/// that gets it there. **Every one of these defaults resolves to
/// non-empty**, so a harness call that does not otherwise care about the
/// Q20 threshold reproduces the exact pre-W13-S6 behaviour (a household
/// lands on `/home`, never `/welcome`) without that test having to know
/// this slice exists. A test that DOES care about the threshold overrides
/// these explicitly, the same way `households`/`householdsError` already
/// let a caller override `meHouseholdsControllerProvider`'s own default.
List<Override> defaultHouseholdActivityOverrides({
  String householdId = 'household-1',
}) => <Override>[
  recipeRepositoryProvider.overrideWithValue(
    FakeRecipeRepository(result: <Recipe>[_activityRecipe(householdId)]),
  ),
  pantryRepositoryProvider.overrideWithValue(
    FakePantryRepository(result: <PantryItem>[_activityPantryItem(householdId)]),
  ),
  menuRepositoryProvider.overrideWithValue(
    FakeMenuRepository(fetchResult: _activityMenuWithItem(householdId)),
  ),
];

/// The same three sources, all configured empty — a household with **zero**
/// recipes, pantry items and planned menu items, i.e. Q20's threshold not
/// yet met. `menuRepositoryProvider`'s `fetchResult: null` (not an empty
/// `Menu`) exercises `CurrentMenuController`'s real get-or-create path
/// (`fetchMenu` returning `null` falls through to `createMenu`), matching
/// what a genuinely fresh household's first `/welcome` visit looks like.
List<Override> emptyHouseholdActivityOverrides({
  String householdId = 'household-1',
}) => <Override>[
  recipeRepositoryProvider.overrideWithValue(
    FakeRecipeRepository(result: const <Recipe>[]),
  ),
  pantryRepositoryProvider.overrideWithValue(
    FakePantryRepository(result: const <PantryItem>[]),
  ),
  menuRepositoryProvider.overrideWithValue(
    FakeMenuRepository(
      fetchResult: null,
      createResult: _emptyActivityMenu(householdId),
    ),
  ),
];

/// Exactly one recipe, nothing else — one arm of Q20's OR, asserted in
/// isolation (`router_test.dart`'s own RED-test discipline: "all three arms
/// asserted separately, never inferred from one another").
List<Override> recipeOnlyActivityOverrides({String householdId = 'household-1'}) =>
    <Override>[
      recipeRepositoryProvider.overrideWithValue(
        FakeRecipeRepository(result: <Recipe>[_activityRecipe(householdId)]),
      ),
      pantryRepositoryProvider.overrideWithValue(
        FakePantryRepository(result: const <PantryItem>[]),
      ),
      menuRepositoryProvider.overrideWithValue(
        FakeMenuRepository(
          fetchResult: null,
          createResult: _emptyActivityMenu(householdId),
        ),
      ),
    ];

/// Exactly one pantry item, nothing else — the second arm.
List<Override> pantryOnlyActivityOverrides({String householdId = 'household-1'}) =>
    <Override>[
      recipeRepositoryProvider.overrideWithValue(
        FakeRecipeRepository(result: const <Recipe>[]),
      ),
      pantryRepositoryProvider.overrideWithValue(
        FakePantryRepository(result: <PantryItem>[_activityPantryItem(householdId)]),
      ),
      menuRepositoryProvider.overrideWithValue(
        FakeMenuRepository(
          fetchResult: null,
          createResult: _emptyActivityMenu(householdId),
        ),
      ),
    ];

/// Exactly one planned menu item, nothing else — the third arm.
List<Override> menuOnlyActivityOverrides({String householdId = 'household-1'}) =>
    <Override>[
      recipeRepositoryProvider.overrideWithValue(
        FakeRecipeRepository(result: const <Recipe>[]),
      ),
      pantryRepositoryProvider.overrideWithValue(
        FakePantryRepository(result: const <PantryItem>[]),
      ),
      menuRepositoryProvider.overrideWithValue(
        FakeMenuRepository(fetchResult: _activityMenuWithItem(householdId)),
      ),
    ];

/// One source (recipes) still resolving, the other two already resolved
/// empty — the direct regression for "while ANY source is still resolving,
/// hold on splash." `neverCompletes: true` (a genuinely pending
/// `Completer`), not a long `delay` — a real `Timer` left pending past this
/// test's own teardown trips `flutter_test`'s "a Timer is still pending"
/// assertion; an uncompleted `Completer` leaves nothing scheduled to trip
/// on.
List<Override> resolvingActivityOverrides({String householdId = 'household-1'}) =>
    <Override>[
      recipeRepositoryProvider.overrideWithValue(
        FakeRecipeRepository(
          result: <Recipe>[_activityRecipe(householdId)],
          neverCompletes: true,
        ),
      ),
      pantryRepositoryProvider.overrideWithValue(
        FakePantryRepository(result: const <PantryItem>[]),
      ),
      menuRepositoryProvider.overrideWithValue(
        FakeMenuRepository(
          fetchResult: null,
          createResult: _emptyActivityMenu(householdId),
        ),
      ),
    ];

/// One source (pantry) errors, the other two resolve empty — the direct
/// regression for "an errored source is treated as unknown, hold — never
/// as empty."
List<Override> erroredActivityOverrides({String householdId = 'household-1'}) =>
    <Override>[
      recipeRepositoryProvider.overrideWithValue(
        FakeRecipeRepository(result: const <Recipe>[]),
      ),
      pantryRepositoryProvider.overrideWithValue(
        FakePantryRepository(error: StateError('network error')),
      ),
      menuRepositoryProvider.overrideWithValue(
        FakeMenuRepository(
          fetchResult: null,
          createResult: _emptyActivityMenu(householdId),
        ),
      ),
    ];
