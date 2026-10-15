// A golden comparator that tolerates a small pixel diff, for goldens that
// contain drawn paths.
//
// Alchemist's CI variant neutralises *text* rasterisation, but not
// `CustomPaint` path anti-aliasing, which differs by a few edge pixels between
// macOS and the Ubuntu CI runner. A file that draws a path (e.g. the back
// chevron) can therefore not be byte-identical across both. This comparator is
// installed per test file via [useTolerantGoldenComparator]; the project-wide
// comparator in `flutter_test_config.dart` is not loosened.
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// Maximum accepted diff, as a fraction (0.005 == 0.5%). Anti-aliasing noise
/// measured on CI was ~0.22%.
const double kTolerantGoldenMaxDiff = 0.005;

class TolerantGoldenComparator extends LocalFileComparator {
  TolerantGoldenComparator(
    super.testFile, {
    this.maxDiff = kTolerantGoldenMaxDiff,
  });

  final double maxDiff;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final ComparisonResult result = await GoldenFileComparator.compareLists(
      imageBytes,
      await getGoldenBytes(golden),
    );
    if (result.passed || result.diffPercent <= maxDiff) {
      return true;
    }
    final String error = await generateFailureOutput(result, golden, basedir);
    throw FlutterError(error);
  }
}

/// Installs a [TolerantGoldenComparator] for the current test file and
/// restores the previous comparator afterwards. Call once at the top of
/// `main()`.
void useTolerantGoldenComparator({double maxDiff = kTolerantGoldenMaxDiff}) {
  late GoldenFileComparator previous;
  setUpAll(() {
    previous = goldenFileComparator;
    final LocalFileComparator current = previous as LocalFileComparator;
    goldenFileComparator = TolerantGoldenComparator(
      Uri.parse('${current.basedir}placeholder_test.dart'),
      maxDiff: maxDiff,
    );
  });
  tearDownAll(() {
    goldenFileComparator = previous;
  });
}
