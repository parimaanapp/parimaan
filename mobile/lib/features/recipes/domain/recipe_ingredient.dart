/// One ingredient line on a recipe. Independent of GraphQL and of
/// `built_value` — same boundary rule as `PantryItem`.
///
/// Not populated by the Library query (`Query.recipes` deliberately never
/// selects `Recipe.ingredients` — E2E_MVP_PLAN.md §12.2.7); only a Detail-
/// scale query (a later slice) produces a list of these. See [Recipe.ingredients]'s
/// own doc.
class RecipeIngredient {
  const RecipeIngredient({
    required this.id,
    required this.name,
    this.quantity,
    this.unit,
    this.category,
    this.notes,
    required this.isStaple,
  });

  final String id;
  final String name;
  final double? quantity;
  final String? unit;
  final String? category;
  final String? notes;
  final bool isStaple;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RecipeIngredient &&
          other.id == id &&
          other.name == name &&
          other.quantity == quantity &&
          other.unit == unit &&
          other.category == category &&
          other.notes == notes &&
          other.isStaple == isStaple;

  @override
  int get hashCode =>
      Object.hash(id, name, quantity, unit, category, notes, isStaple);
}
