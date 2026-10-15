/// The client-authored shape of one ingredient row in the create/edit form
/// — mirrors `RecipeIngredientInput` on the wire (W6 S8). No `id`: unlike
/// [RecipeIngredient] (a persisted row), a draft row has none yet, and the
/// wire input itself has no `id` field either — `updateRecipe`'s
/// whole-list-replace semantic for `ingredients` (E2E_MVP_PLAN.md §12.2.4)
/// means the form always sends every row fresh, never a per-row diff, so
/// there is nothing an id would let the server line up against.
class RecipeIngredientDraft {
  const RecipeIngredientDraft({
    required this.name,
    this.quantity,
    this.unit,
    this.category,
    this.notes,
    this.isStaple = false,
  });

  final String name;
  final double? quantity;
  final String? unit;
  final String? category;
  final String? notes;
  final bool isStaple;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RecipeIngredientDraft &&
          other.name == name &&
          other.quantity == quantity &&
          other.unit == unit &&
          other.category == category &&
          other.notes == notes &&
          other.isStaple == isStaple;

  @override
  int get hashCode => Object.hash(name, quantity, unit, category, notes, isStaple);
}
