import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';

/// A [Household] whose `mealStructureJson` is a REAL, complete document
/// (matching the server's own `DEFAULT_MEAL_STRUCTURE`) — unlike
/// `household_fixtures.dart`'s own `testHousehold`, whose
/// `'{"breakfast":{"items":2}}'` is a setup-wizard-oriented fixture with no
/// `lunch`/`dinner` keys at all. `plannedSlotsForDay` now fails CLOSED
/// (zero slots) on a missing entry, mirroring the server's own
/// `getMealSlotCap` (`domain/meal_slot_plan.dart`'s own doc) — this fixture
/// exists so menu-feature tests exercise the real, well-formed-document
/// path rather than that fail-closed one by accident.
final Household testMenuHousehold = Household(
  id: 'household-1',
  name: 'Kulkarni Kitchen',
  inviteCode: 'ABC123',
  primaryUserId: 'user-1',
  subscriptionStatus: SubscriptionStatus.free,
  settings: const HouseholdSettings(
    householdId: 'household-1',
    mealsEnabled: <String>['breakfast', 'lunch', 'dinner'],
    mealStructureJson: '{"lunch":{"carb":1,"sabzi_dal":2,"accompaniment":1},"dinner":{"carb":1,"sabzi_dal":2,"accompaniment":1}}',
    cuisineTier1: <String>['north_indian'],
    cuisineTier2WeightsJson: '{}',
    dietaryTags: <String>['veg'],
    allergens: <String>[],
    skipIngredients: <String>[],
  ),
  members: <HouseholdMembership>[
    HouseholdMembership(
      id: 'membership-1',
      role: HouseholdRole.primary,
      joinedAt: DateTime.utc(2026, 8, 20),
      user: const HouseholdMember(id: 'user-1', email: 'asha@example.com'),
    ),
  ],
);

/// A domain [Recipe], for tests that need one without a wire round trip.
final Recipe testMenuRecipe = Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Rajma',
  servings: 4,
  dietaryTags: const <String>['veg'],
  role: RecipeRole.sabziDal,
  inRotation: true,
  isFavorite: false,
  steps: const <String>['Soak overnight', 'Pressure cook'],
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
);

/// A domain [MenuItem], for tests that need one without a wire round trip.
final MenuItem testMenuItem = MenuItem(
  id: 'menu-item-1',
  menuId: 'menu-1',
  recipe: testMenuRecipe,
  dayOfWeek: 0,
  mealSlot: 'lunch',
  slotRole: RecipeRole.sabziDal,
);

/// A domain [Menu] with no items — the expected first-visit state for a
/// fresh week.
final Menu testEmptyMenu = Menu(
  id: 'menu-1',
  householdId: 'household-1',
  weekStartDate: DateTime.utc(2026, 9, 7),
  items: const <MenuItem>[],
);

/// A domain [Menu] with one item, for tests that need a non-empty week.
final Menu testMenuWithItems = Menu(
  id: 'menu-1',
  householdId: 'household-1',
  weekStartDate: DateTime.utc(2026, 9, 7),
  items: <MenuItem>[testMenuItem],
);

/// The exact JSON AppSync returns for the shared `MenuRecipeFields`
/// fragment — same list-shape field set `recipes.graphql` selects, per that
/// fragment's own doc.
Map<String, dynamic> menuRecipeWireNode({
  String id = 'recipe-1',
  String householdId = 'household-1',
  String sourceType = 'user',
  String title = 'Rajma',
  String role = 'sabzi_dal',
  bool inRotation = true,
  bool isFavorite = false,
}) => <String, dynamic>{
  '__typename': 'Recipe',
  'id': id,
  'householdId': householdId,
  'sourceType': sourceType,
  'sourceUrl': null,
  'title': title,
  'description': null,
  'servings': 4,
  'prepMin': 10,
  'cookMin': 20,
  'cuisineTier1': 'north_indian',
  'cuisineTier2': null,
  'dietaryTags': <String>['veg'],
  'role': role,
  'inRotation': inRotation,
  'isFavorite': isFavorite,
  'steps': <String>['Soak overnight', 'Pressure cook'],
  'createdAt': '2026-09-01T00:00:00.000Z',
  'updatedAt': '2026-09-01T00:00:00.000Z',
};

/// The exact JSON AppSync returns for the shared `MenuItemFields` fragment.
Map<String, dynamic> menuItemWireNode({
  String id = 'menu-item-1',
  String menuId = 'menu-1',
  int dayOfWeek = 0,
  String mealSlot = 'lunch',
  String slotRole = 'sabzi_dal',
  int? servingsOverride,
  String? madeAt,
  Map<String, dynamic>? recipe,
}) => <String, dynamic>{
  '__typename': 'MenuItem',
  'id': id,
  'menuId': menuId,
  'dayOfWeek': dayOfWeek,
  'mealSlot': mealSlot,
  'slotRole': slotRole,
  'servingsOverride': servingsOverride,
  'madeAt': madeAt,
  'recipe': recipe ?? menuRecipeWireNode(),
};

/// The exact JSON AppSync returns for the shared `MenuFields` fragment.
Map<String, dynamic> menuWireNode({
  String id = 'menu-1',
  String householdId = 'household-1',
  String weekStartDate = '2026-09-07T00:00:00.000Z',
  List<Map<String, dynamic>>? items,
}) => <String, dynamic>{
  '__typename': 'Menu',
  'id': id,
  'householdId': householdId,
  'weekStartDate': weekStartDate,
  'items': items ?? <Map<String, dynamic>>[],
};

/// `Query.menu`'s own response shape — `menu` is nullable, so [menu] being
/// `null` here is itself a real, meaningful fixture (no menu yet), not an
/// unconfigured default.
Map<String, dynamic> menuQueryWireData({Map<String, dynamic>? menu}) =>
    <String, dynamic>{'menu': menu};

Map<String, dynamic> createMenuWireData({Map<String, dynamic>? menu}) =>
    <String, dynamic>{'createMenu': menu ?? menuWireNode()};

Map<String, dynamic> addMenuItemWireData({Map<String, dynamic>? item}) =>
    <String, dynamic>{'addMenuItem': item ?? menuItemWireNode()};

Map<String, dynamic> removeMenuItemWireData({bool result = true}) =>
    <String, dynamic>{'removeMenuItem': result};
