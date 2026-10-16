import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/format/quantity_format.dart';

void main() {
  test('drops trailing zeros and caps at two decimals', () {
    expect(formatQuantity(2.0), '2');
    expect(formatQuantity(100.0), '100');
    expect(formatQuantity(1.5), '1.5');
    expect(formatQuantity(0.3333333333333333), '0.33');
    expect(formatQuantity(0.001), '0');
    expect(formatQuantity(-0.001), '0');
  });
}
