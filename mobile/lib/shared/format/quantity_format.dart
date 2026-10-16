/// Display form of any quantity (list, pantry, recipes, cook): at most two decimals, trailing zeros
/// dropped, so `0.3333333333333333` reads `0.33` and `2.0` reads `2`.
/// Display only — the stored quantity is never rounded.
String formatQuantity(double quantity) {
  final String fixed = quantity.toStringAsFixed(2);
  final String trimmed = fixed.contains('.')
      ? fixed.replaceFirst(RegExp(r'\.?0+$'), '')
      : fixed;
  // Tiny values round to `-0` / `0.00`; show a plain `0`.
  return (trimmed == '-0' || trimmed.isEmpty) ? '0' : trimmed;
}

/// Whether an editable field still shows the untouched [formatQuantity] of
/// [original]. Callers write back [original] (full precision) in that case,
/// so merely opening and saving a form never rounds a stored quantity.
bool isUntouchedQuantity(String text, double? original) =>
    original != null && text.trim() == formatQuantity(original);
