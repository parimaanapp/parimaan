import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/frame_brightness.dart';

void main() {
  group('averageLuma', () {
    test('returns 0 for an empty frame rather than dividing by zero', () {
      expect(averageLuma(<int>[]), 0);
    });

    test('returns the mean of a uniform frame', () {
      expect(averageLuma(List<int>.filled(100, 200)), 200);
    });

    test('returns the true mean of a mixed frame, not just the first byte', () {
      expect(averageLuma(<int>[0, 100, 200]), 100);
    });
  });

  group('isFrameTooDark', () {
    test('flags a frame at or below the threshold', () {
      expect(isFrameTooDark(30, threshold: 50), isTrue);
      expect(isFrameTooDark(50, threshold: 50), isTrue);
    });

    test('does not flag a frame above the threshold', () {
      expect(isFrameTooDark(51, threshold: 50), isFalse);
    });

    test('uses unverifiedDarkFrameLumaThreshold as its default', () {
      expect(isFrameTooDark(unverifiedDarkFrameLumaThreshold), isTrue);
      expect(isFrameTooDark(unverifiedDarkFrameLumaThreshold + 1), isFalse);
    });
  });
}
