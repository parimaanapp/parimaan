/// A partial patch for `Mutation.updatePantryItem`, mirroring the GraphQL
/// `PantryItemPatchInput`. Same "`null` means absent, and that's the whole
/// model" reasoning as `features/household/domain/household_settings_patch.dart`
/// — the server rejects an explicit `null` as `VALIDATION`, so there is no
/// third state this type needs to express.
class PantryItemPatch {
  /// A patch with any subset of fields.
  ///
  /// The assert mirrors the server's own `.refine(...)`: a patch with every
  /// field absent is rejected as `VALIDATION`, and there is nothing a caller
  /// could have meant by it — same "catch it at construction, not after a
  /// round trip" reasoning as `HouseholdSettingsPatch`.
  const PantryItemPatch({
    this.name,
    this.quantity,
    this.unit,
    this.category,
    this.isStaple,
    this.expiryDate,
    this.lowThreshold,
  }) : assert(
         name != null ||
             quantity != null ||
             unit != null ||
             category != null ||
             isStaple != null ||
             expiryDate != null ||
             lowThreshold != null,
         'A patch must contain at least one field — the server rejects an '
         'all-absent input as VALIDATION.',
       );

  final String? name;
  final double? quantity;
  final String? unit;
  final String? category;
  final bool? isStaple;

  /// `YYYY-MM-DD`, or `null` (absent — not "clear the expiry date").
  final String? expiryDate;
  final double? lowThreshold;
}
