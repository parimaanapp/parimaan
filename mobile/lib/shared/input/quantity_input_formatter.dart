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
    final int dot = text.indexOf('.');
    if (dot < 0 || text.length - dot - 1 <= quantityMaxDecimals) {
      return newValue;
    }
    // Typing a third decimal keeps the old value; a paste is clamped.
    final bool isPaste = text.length - oldValue.text.length > 1;
    if (!isPaste) {
      return oldValue;
    }
    final String clamped = text.substring(0, dot + 1 + quantityMaxDecimals);
    return TextEditingValue(
      text: clamped,
      selection: TextSelection.collapsed(offset: clamped.length),
    );
  }
}

/// [value] rounded to [quantityMaxDecimals] places.
double roundQuantity(double value) =>
    double.parse(value.toStringAsFixed(quantityMaxDecimals));
