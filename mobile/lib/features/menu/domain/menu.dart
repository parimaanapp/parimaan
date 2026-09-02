/// The app's own menu types, independent of GraphQL and of `built_value` —
/// same boundary rule as `features/household/domain/household.dart`. Nothing
/// generated appears here; the mapping from the generated types lives in
/// `../data/menu_mapper.dart`.
library;

import '../../recipes/domain/recipe.dart';
import '../../recipes/domain/recipe_role.dart';

/// One household's meal plan for a single calendar week (E2E_MVP_PLAN.md
/// §15). [weekStartDate] is a calendar date, not a timezone-attached instant
/// — the server stores it as a plain `DATE` and only widens it to
/// `AWSDateTime` on the wire (`docs/E2E_MVP_PLAN.md` §15.2.4); this type
/// keeps the `DateTime` ferry hands back rather than re-narrowing it to a
/// date-only type of its own, since nothing here needs to defend against
/// its time-of-day component (which is always midnight UTC).
class Menu {
  const Menu({
    required this.id,
    required this.householdId,
    required this.weekStartDate,
    required this.items,
  });

  final String id;
  final String householdId;
  final DateTime weekStartDate;
  final List<MenuItem> items;

  /// Every item on [dayOfWeek] (0 = the week's first day), in `Menu.items`'
  /// own server-side order (day, meal slot, placement time) — see
  /// `menuRepository.ts`'s `findMenuItems` for that ordering.
  List<MenuItem> itemsForDay(int dayOfWeek) => items
      .where((MenuItem item) => item.dayOfWeek == dayOfWeek)
      .toList(growable: false);

  @override
  String toString() => 'Menu(id: $id, weekStartDate: $weekStartDate)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is Menu && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// One recipe placed into one slot of a [Menu]. [slotRole] is captured at
/// placement time and does NOT track [recipe]'s own `role` if that changes
/// later — a menu is a snapshot of what was planned, not a live view
/// (`shared/schema.graphql`'s own `MenuItem` doc).
class MenuItem {
  const MenuItem({
    required this.id,
    required this.menuId,
    required this.recipe,
    required this.dayOfWeek,
    required this.mealSlot,
    required this.slotRole,
    this.servingsOverride,
    this.madeAt,
  });

  final String id;
  final String menuId;
  final Recipe recipe;
  final int dayOfWeek;

  /// Raw `MealType` wire value (`'breakfast'`/`'lunch'`/`'snacks'`/
  /// `'dinner'`) — kept as a string rather than `household/domain/meal_type.dart`'s
  /// `MealType`, which is an encode-only type built for the setup wizard's
  /// own toggles (no `unknown` member, no decode direction — see its own
  /// class doc) and not a fit for a value this type must *decode* from the
  /// server. Same "no consumer needs the typed enum yet" reasoning
  /// `HouseholdSettings.mealsEnabled` already uses.
  final String mealSlot;

  final RecipeRole slotRole;
  final int? servingsOverride;
  final DateTime? madeAt;

  @override
  String toString() =>
      'MenuItem(id: $id, mealSlot: $mealSlot, slotRole: ${slotRole.name})';

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is MenuItem && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// The draft `addMenuItem` sends — mirrors `MenuItemInput` (`shared/schema.graphql`)
/// field-for-field, minus nothing: every field on the wire input has a home
/// here.
class NewMenuItem {
  const NewMenuItem({
    required this.recipeId,
    required this.dayOfWeek,
    required this.mealSlot,
    required this.slotRole,
    this.servingsOverride,
  });

  final String recipeId;
  final int dayOfWeek;

  /// Raw `MealType` wire value — see [MenuItem.mealSlot]'s doc for why.
  final String mealSlot;

  final RecipeRole slotRole;
  final int? servingsOverride;
}

/// One slot `autoFillPreview`/`autoFillWeek` could not fill (W10 §16.2.3,
/// D5) — either the household has no in-rotation recipes for [slotRole] at
/// all, or (only reachable via a commit's own live re-validation) the slot
/// stopped being available between when a proposal was generated and when
/// it was committed. Never distinguishes the two reasons — see each
/// repository method's own doc for what's actually knowable at that point.
class UnfilledSlot {
  const UnfilledSlot({
    required this.dayOfWeek,
    required this.mealSlot,
    required this.slotRole,
  });

  final int dayOfWeek;

  /// Raw `MealType` wire value — see [MenuItem.mealSlot]'s doc for why.
  final String mealSlot;

  final RecipeRole slotRole;

  @override
  String toString() =>
      'UnfilledSlot(dayOfWeek: $dayOfWeek, mealSlot: $mealSlot, slotRole: ${slotRole.name})';
}

/// One recipe `autoFillPreview` proposes for one empty slot — NOT YET
/// written to `menu_items` (W10 §16.2.1's dry-run design). Deliberately
/// carries the same four fields [NewMenuItem] does (minus
/// `servingsOverride`, which a proposal never sets) so a
/// [ProposedMenuItem] converts straight into a [NewMenuItem] for
/// `autoFillWeek`'s own `items` argument — see [ProposedMenuItem.toDraft].
class ProposedMenuItem {
  const ProposedMenuItem({
    required this.recipeId,
    required this.recipe,
    required this.dayOfWeek,
    required this.mealSlot,
    required this.slotRole,
  });

  final String recipeId;
  final Recipe recipe;
  final int dayOfWeek;

  /// Raw `MealType` wire value — see [MenuItem.mealSlot]'s doc for why.
  final String mealSlot;

  final RecipeRole slotRole;

  /// The [NewMenuItem] this proposal becomes when submitted to
  /// `autoFillWeek` — verbatim if accepted as-is, or a caller may build a
  /// different [NewMenuItem] for the same slot instead (a manual swap).
  NewMenuItem toDraft() => NewMenuItem(
    recipeId: recipeId,
    dayOfWeek: dayOfWeek,
    mealSlot: mealSlot,
    slotRole: slotRole,
  );

  @override
  String toString() =>
      'ProposedMenuItem(recipeId: $recipeId, dayOfWeek: $dayOfWeek, mealSlot: $mealSlot, slotRole: ${slotRole.name})';
}

/// `Query.autoFillPreview`'s result — a proposal, not yet written. See
/// `MenuRepository.autoFillPreview`'s own doc for the dry-run contract.
class AutoFillPreviewResult {
  const AutoFillPreviewResult({
    required this.items,
    required this.filledCount,
    required this.unfilledSlots,
  });

  final List<ProposedMenuItem> items;
  final int filledCount;
  final List<UnfilledSlot> unfilledSlots;
}

/// `Mutation.autoFillWeek`'s result — the committed [menu], plus how many
/// of the submitted items actually landed. `filledCount` can legitimately
/// be LOWER than the number of items submitted: `autoFillWeek` re-validates
/// every item against live state rather than trusting the caller's own
/// proposal, and silently skips anything that no longer fits (W10 §16.2.1,
/// D6 — best-effort partial, never an error).
class AutoFillResult {
  const AutoFillResult({
    required this.menu,
    required this.filledCount,
    required this.unfilledSlots,
  });

  final Menu menu;
  final int filledCount;
  final List<UnfilledSlot> unfilledSlots;
}
