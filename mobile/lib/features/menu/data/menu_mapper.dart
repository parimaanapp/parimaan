import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/operations/__generated__/menu_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/menu_item_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/menu_recipe_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/proposed_menu_item_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/unfilled_slot_fields.data.gql.dart';
import '../../recipes/data/recipe_mapper.dart';
import '../../recipes/domain/recipe.dart';
import '../domain/menu.dart';

/// The boundary where Ferry / `built_value` types become the plain domain
/// [Menu] — same rule and precedent as `features/recipes/data/recipe_mapper.dart`.
///
/// Takes the **fragment** interface `GMenuFields`, not either operation's
/// own generated element type — `Query.menu` and `Mutation.createMenu` both
/// spread `MenuFields`, so this one mapper serves both, the same
/// `HouseholdFields`/`RecipeDetailFields` shape every other multi-operation
/// return type in this codebase uses.
Menu menuFromGraphQL(GMenuFields data) => Menu(
  id: data.id,
  householdId: data.householdId,
  weekStartDate: data.weekStartDate,
  items: data.items.map(menuItemFromGraphQL).toList(growable: false),
);

/// The `MenuItem` counterpart to [menuFromGraphQL] — also a fragment
/// interface (`MenuItemFields`), shared by `Menu.items` (via [menuFromGraphQL])
/// and `Mutation.addMenuItem`'s own return value.
MenuItem menuItemFromGraphQL(GMenuItemFields data) => MenuItem(
  id: data.id,
  menuId: data.menuId,
  recipe: _menuRecipeFromGraphQL(data.recipe),
  dayOfWeek: data.dayOfWeek,
  // Raw wire value — see `MenuItem.mealSlot`'s own doc for why this isn't
  // the `household/domain/meal_type.dart` `MealType` enum.
  mealSlot: data.mealSlot.name,
  slotRole: recipeRoleFromGraphQL(data.slotRole),
  servingsOverride: data.servingsOverride,
  madeAt: data.madeAt,
);

/// [MenuRecipeFields]'s own field set mirrors `Query.recipes`' list-shape
/// selection exactly (see that `.graphql` file's own doc), so this mapper is
/// structurally identical to `recipeFromGraphQL` — kept as its own function
/// rather than a generic helper because the two source types
/// (`GMenuRecipeFields` vs. `GRecipesData_recipes`) are nominally distinct
/// generated interfaces with no common supertype ferry emits.
Recipe _menuRecipeFromGraphQL(GMenuRecipeFields data) => Recipe(
  id: data.id,
  householdId: data.householdId,
  sourceType: recipeSourceFromGraphQL(data.sourceType),
  sourceUrl: data.sourceUrl,
  title: data.title,
  description: data.description,
  servings: data.servings,
  prepMin: data.prepMin,
  cookMin: data.cookMin,
  cuisineTier1: data.cuisineTier1?.name,
  cuisineTier2: data.cuisineTier2,
  dietaryTags: data.dietaryTags
      .map((GDietaryTag value) => value.name)
      .toList(growable: false),
  role: recipeRoleFromGraphQL(data.role),
  inRotation: data.inRotation,
  isFavorite: data.isFavorite,
  steps: data.steps.toList(growable: false),
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
);

/// The generated `GMenuItemInput` for a domain [NewMenuItem] — the write
/// direction, for `Mutation.addMenuItem`'s `$input` variable.
GMenuItemInput menuItemInputToGraphQL(NewMenuItem draft) =>
    (GMenuItemInputBuilder()
          ..recipeId = draft.recipeId
          ..dayOfWeek = draft.dayOfWeek
          ..mealSlot = _mealSlotToGraphQL(draft.mealSlot)
          ..slotRole = recipeRoleToGraphQL(draft.slotRole)
          ..servingsOverride = draft.servingsOverride)
        .build();

/// [NewMenuItem.mealSlot] is a raw `MealType` wire value (see that field's
/// own doc), so this is an explicit string-to-enum switch rather than a
/// reuse of `household/data/household_mapper.dart`'s `_mealTypeToGraphQL`
/// (which starts from the typed, encode-only `MealType` this codebase
/// deliberately doesn't reuse here). Any value outside the four the server
/// accepts is a caller bug — `NewMenuItem.mealSlot` is always built from
/// `MenuItem.mealSlot` (itself always a real wire value the server sent) or
/// a UI constant, never free-typed input.
GMealType _mealSlotToGraphQL(String mealSlot) => switch (mealSlot) {
  'breakfast' => GMealType.breakfast,
  'lunch' => GMealType.lunch,
  'snacks' => GMealType.snacks,
  'dinner' => GMealType.dinner,
  _ => throw ArgumentError('Unrecognized MealType wire value: $mealSlot'),
};

/// The `UnfilledSlot` counterpart to [menuFromGraphQL] — a fragment
/// interface (`UnfilledSlotFields`), shared by `AutoFillPreviewResult` and
/// `AutoFillResult` (W10 §16.2.3).
UnfilledSlot unfilledSlotFromGraphQL(GUnfilledSlotFields data) =>
    UnfilledSlot(
      dayOfWeek: data.dayOfWeek,
      mealSlot: data.mealSlot.name,
      slotRole: recipeRoleFromGraphQL(data.slotRole),
    );

/// The `ProposedMenuItem` counterpart to [menuItemFromGraphQL] —
/// `AutoFillPreviewResult.items`' own shape (W10 §16.2.1). Reuses
/// [_menuRecipeFromGraphQL] for the same list-scale `Recipe` selection
/// `MenuItemFields` embeds.
ProposedMenuItem proposedMenuItemFromGraphQL(GProposedMenuItemFields data) =>
    ProposedMenuItem(
      recipeId: data.recipeId,
      recipe: _menuRecipeFromGraphQL(data.recipe),
      dayOfWeek: data.dayOfWeek,
      mealSlot: data.mealSlot.name,
      slotRole: recipeRoleFromGraphQL(data.slotRole),
    );
