/// One ingredient row within an [AiRecipeDraft] — mirrors the GraphQL
/// `RecipeIngredientDraft` type (E2E_MVP_PLAN.md §13.2.3). [raw] is always
/// kept verbatim, even when [quantity]/[unit] could not be decomposed from
/// it — the server-side parser's own "never silently drop the source
/// text" contract, carried through unchanged on this client.
class AiRecipeDraftIngredient {
  const AiRecipeDraftIngredient({
    required this.raw,
    required this.name,
    this.quantity,
    this.unit,
    this.notes,
  });

  final String raw;
  final String name;
  final double? quantity;
  final String? unit;
  final String? notes;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AiRecipeDraftIngredient &&
          other.raw == raw &&
          other.name == name &&
          other.quantity == quantity &&
          other.unit == unit &&
          other.notes == notes;

  @override
  int get hashCode => Object.hash(raw, name, quantity, unit, notes);
}
