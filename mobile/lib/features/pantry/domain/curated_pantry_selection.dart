import 'package:flutter/foundation.dart';

/// One curated item ticked in `CuratedItemsSheet` (W14 S5,
/// E2E_MVP_PLAN.md §20.2.5/§20.2.6), carrying the quantity/unit the user
/// set through the sheet's own per-item stepper.
///
/// Deliberately a name/quantity/unit triple only — no `category` field. The
/// sheet that produces these already knows its own category (the
/// `curatedPantryItems` key it was opened for); S6's commit
/// (E2E_MVP_PLAN.md §20.2.7, D7) supplies it once for the whole batch rather
/// than repeating it per item, matching the shape
/// `bulkAddPantryItems`'s `PantryItemInput` ultimately wants.
@immutable
class CuratedPantrySelection {
  const CuratedPantrySelection({
    required this.name,
    required this.quantity,
    required this.unit,
  });

  /// The curated item's name, taken verbatim from `curatedPantryItems` —
  /// never edited by the sheet itself.
  final String name;

  /// Always user-supplied through the stepper. `curatedPantryItems` never
  /// carries a quantity (D5's third property), so there is no default to
  /// fall back to here either.
  final double quantity;

  /// One of `knownPantryUnits` — the stepper restricts entry to exactly
  /// that list (D6), so this is never anything else.
  final String unit;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CuratedPantrySelection &&
          other.name == name &&
          other.quantity == quantity &&
          other.unit == unit);

  @override
  int get hashCode => Object.hash(name, quantity, unit);

  @override
  String toString() =>
      'CuratedPantrySelection(name: $name, quantity: $quantity, unit: $unit)';
}
