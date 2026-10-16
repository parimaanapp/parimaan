import 'package:flutter/services.dart';

/// The most decimal places a quantity field accepts (catalog and pantry
/// quantities are shown and stored to two decimals).
const int quantityMaxDecimals = 2;

final RegExp _quantityPattern = RegExp(r'^\d*\.?\d*$');

/// Keeps a quantity field to digits with at most [quantityMaxDecimals]
/// decimals. Typing a third decimal is ignored; a pasted longer fraction is
/// clamped rather than rejected whole, so a paste of `1.23456` still lands.
class QuantityInputFormatter extends TextInputFormatter {
  QuantityInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final String text = newValue.text;
    if (!_quantityPattern.hasMatch(text)) {
      return oldValue;
    }
    final int decimals = _decimals(text);
    if (decimals <= quantityMaxDecimals) {
      return newValue;
    }
    // Deletions and edits of an already-long seeded value are always fine:
    // only text that adds a decimal beyond two is restricted.
    final int oldDecimals = _decimals(oldValue.text);
    if (decimals <= oldDecimals) {
      return newValue;
    }
    // A single typed third decimal is ignored; anything bigger (a paste,
    // also over a selection) is clamped rather than dropped.
    if (_isSingleInsertion(oldValue.text, text) &&
        oldDecimals <= quantityMaxDecimals) {
      return oldValue;
    }
    final int dot = text.indexOf('.');
    final String clamped = text.substring(0, dot + 1 + quantityMaxDecimals);
    return TextEditingValue(
      text: clamped,
      selection: TextSelection.collapsed(offset: clamped.length),
    );
  }

  static bool _isSingleInsertion(String before, String after) {
    if (after.length != before.length + 1) {
      return false;
    }
    for (int i = 0; i < after.length; i++) {
      if (after.substring(0, i) + after.substring(i + 1) == before) {
        return true;
      }
    }
    return false;
  }

  static int _decimals(String text) {
    final int dot = text.indexOf('.');
    return dot < 0 ? 0 : text.length - dot - 1;
  }
}

/// [value] rounded to [quantityMaxDecimals] places.
double roundQuantity(double value) =>
    double.parse(value.toStringAsFixed(quantityMaxDecimals));
