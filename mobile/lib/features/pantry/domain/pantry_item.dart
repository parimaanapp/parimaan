import 'running_low.dart' as running_low;

/// The app's own pantry-item type, independent of GraphQL and of
/// `built_value` — same boundary rule as `features/household/domain/household.dart`.
/// The mapping from the generated types lives in `../data/pantry_mapper.dart`.
class PantryItem {
  const PantryItem({
    required this.id,
    required this.householdId,
    required this.name,
    required this.quantity,
    required this.unit,
    this.category,
    required this.isStaple,
    this.expiryDate,
    this.lowThreshold,
    required this.addedBy,
    required this.addedAt,
    required this.updatedAt,
  });

  final String id;
  final String householdId;
  final String name;
  final double quantity;
  final String unit;
  final String? category;
  final bool isStaple;

  /// `YYYY-MM-DD`, or `null` — `AWSDate` on the wire. Kept as a raw string
  /// rather than parsed to `DateTime`, matching `shared/schema.graphql`'s
  /// own rationale for why this field isn't `AWSDateTime`: a `DateTime` in
  /// Dart carries a time-of-day and (implicitly, via `toLocal()`/formatting
  /// call sites) a timezone that this value was never meant to have. Display
  /// formatting reads the three components directly off the string.
  final String? expiryDate;
  final double? lowThreshold;
  final String addedBy;
  final DateTime addedAt;
  final DateTime updatedAt;

  bool get isRunningLow =>
      running_low.isRunningLow(quantity: quantity, lowThreshold: lowThreshold);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PantryItem &&
          other.id == id &&
          other.householdId == householdId &&
          other.name == name &&
          other.quantity == quantity &&
          other.unit == unit &&
          other.category == category &&
          other.isStaple == isStaple &&
          other.expiryDate == expiryDate &&
          other.lowThreshold == lowThreshold &&
          other.addedBy == addedBy &&
          other.addedAt == addedAt &&
          other.updatedAt == updatedAt;

  @override
  int get hashCode => Object.hash(
    id,
    householdId,
    name,
    quantity,
    unit,
    category,
    isStaple,
    expiryDate,
    lowThreshold,
    addedBy,
    addedAt,
    updatedAt,
  );
}
