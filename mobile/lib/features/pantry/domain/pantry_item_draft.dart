/// The client-authored shape of a new pantry item — mirrors `PantryItemInput`
/// on the wire. Has no `addedBy` field, matching the SDL: that value is
/// always the verified caller, never client-supplied.
class PantryItemDraft {
  const PantryItemDraft({
    required this.name,
    required this.quantity,
    required this.unit,
    this.category,
    this.isStaple = false,
    this.expiryDate,
    this.lowThreshold,
  });

  final String name;
  final double quantity;
  final String unit;
  final String? category;
  final bool isStaple;

  /// `YYYY-MM-DD`, or `null`.
  final String? expiryDate;
  final double? lowThreshold;
}
