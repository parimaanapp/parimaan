import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/running_low.dart';

void main() {
  group('isRunningLow', () {
    test('false when lowThreshold is null, regardless of quantity', () {
      expect(isRunningLow(quantity: 0, lowThreshold: null), isFalse);
      expect(isRunningLow(quantity: 100, lowThreshold: null), isFalse);
    });

    test('true when quantity is below lowThreshold', () {
      expect(isRunningLow(quantity: 1, lowThreshold: 2), isTrue);
    });

    test('true when quantity exactly equals lowThreshold (boundary)', () {
      expect(isRunningLow(quantity: 2, lowThreshold: 2), isTrue);
    });

    test('false when quantity is above lowThreshold', () {
      expect(isRunningLow(quantity: 3, lowThreshold: 2), isFalse);
    });

    test('true when quantity is zero and lowThreshold is positive', () {
      expect(isRunningLow(quantity: 0, lowThreshold: 1), isTrue);
    });

    test('true when quantity and lowThreshold are both zero (boundary, per the locked formula)', () {
      expect(isRunningLow(quantity: 0, lowThreshold: 0), isTrue);
    });
  });
}
