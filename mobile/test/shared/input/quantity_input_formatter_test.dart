import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/input/quantity_input_formatter.dart';

TextEditingValue _v(String text) => TextEditingValue(
  text: text,
  selection: TextSelection.collapsed(offset: text.length),
);

void main() {
  final QuantityInputFormatter formatter = QuantityInputFormatter();

  String apply(String before, String after) =>
      formatter.formatEditUpdate(_v(before), _v(after)).text;

  test('accepts integers and up to two decimals', () {
    expect(apply('', '2'), '2');
    expect(apply('2', '2.'), '2.');
    expect(apply('2.', '2.5'), '2.5');
    expect(apply('2.5', '2.55'), '2.55');
  });

  test('rejects a third decimal by keeping the previous value', () {
    expect(apply('2.55', '2.555'), '2.55');
  });

  test('rejects letters, a second dot and a minus sign', () {
    expect(apply('2', '2a'), '2');
    expect(apply('2.5', '2.5.1'), '2.5');
    expect(apply('', '-1'), '');
  });

  test('allows a leading dot while typing', () {
    expect(apply('', '.'), '.');
    expect(apply('.', '.5'), '.5');
  });

  test('clamps a pasted over-long fraction to two decimals', () {
    expect(apply('', '1.23456'), '1.23');
  });

  test('roundQuantity rounds to two decimals', () {
    expect(roundQuantity(0.333333), 0.33);
    expect(roundQuantity(2), 2.0);
    expect(roundQuantity(1.005 * 1000), 1005.0);
  });
}
