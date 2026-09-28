/// W20 S5 — the client-side shape of `Mutation.analyzePantryPhoto`'s answer
/// (`E2E_MVP_PLAN.md` §27). UNSAVED proposals: the pantry changes only when
/// the user confirms them through `bulkAddPantryItems` (PRD §5.4).
library;

/// How sure the model said it was. Shown as text as well as styling, and
/// `low` proposals start unticked in the review screen (W20 D12).
enum ProposalConfidence { high, medium, low }

/// One AI-proposed pantry item.
///
/// `quantity`/`unit` are the model's container-count guess ("1 jar") — a
/// default for the user to correct, never a measured weight (W20 D6). Both
/// can be null: `unit` is null when the model's unit wasn't one a photo can
/// support, `quantity` when it wasn't a usable number.
class PantryPhotoProposal {
  PantryPhotoProposal({
    required this.name,
    required this.quantity,
    required this.unit,
    required this.category,
    required this.confidence,
    required List<String> warnings,
  }) : warnings = List<String>.unmodifiable(warnings);

  const PantryPhotoProposal._const({
    required this.name,
    required this.quantity,
    required this.unit,
    required this.category,
    required this.confidence,
    required this.warnings,
  });

  final String name;
  final double? quantity;
  final String? unit;
  final String category;
  final ProposalConfidence confidence;

  /// Non-blocking notes (a unit or category was corrected server-side).
  final List<String> warnings;

  /// Returns an edited copy; the original is never mutated. Nullable fields
  /// use explicit `clear…` flags because `quantity: null` cannot distinguish
  /// "leave it" from "remove it".
  PantryPhotoProposal copyWith({
    String? name,
    double? quantity,
    bool clearQuantity = false,
    String? unit,
    bool clearUnit = false,
    String? category,
    ProposalConfidence? confidence,
  }) => PantryPhotoProposal._const(
    name: name ?? this.name,
    quantity: clearQuantity ? null : (quantity ?? this.quantity),
    unit: clearUnit ? null : (unit ?? this.unit),
    category: category ?? this.category,
    confidence: confidence ?? this.confidence,
    warnings: warnings,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PantryPhotoProposal &&
          other.name == name &&
          other.quantity == quantity &&
          other.unit == unit &&
          other.category == category &&
          other.confidence == confidence &&
          _listEquals(other.warnings, warnings);

  @override
  int get hashCode => Object.hash(name, quantity, unit, category, confidence, Object.hashAll(warnings));

  @override
  String toString() => 'PantryPhotoProposal($name, $quantity $unit, $category, ${confidence.name})';
}

/// The whole answer for one photo.
class PantryPhotoAnalysis {
  PantryPhotoAnalysis({required List<PantryPhotoProposal> items, required this.droppedCount, required this.truncated})
    : items = List<PantryPhotoProposal>.unmodifiable(items);

  final List<PantryPhotoProposal> items;

  /// How many items the server removed as generic placeholders or non-food.
  final int droppedCount;

  /// True when more than 40 items survived filtering and the tail was cut.
  final bool truncated;

  /// No identifiable items — a normal, successful answer (about 1 in 10 real
  /// photos in W19's corpus), never an error.
  bool get isEmpty => items.isEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PantryPhotoAnalysis &&
          other.droppedCount == droppedCount &&
          other.truncated == truncated &&
          _listEquals(other.items, items);

  @override
  int get hashCode => Object.hash(droppedCount, truncated, Object.hashAll(items));
}

bool _listEquals<T>(List<T> a, List<T> b) {
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
