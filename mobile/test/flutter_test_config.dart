// Alchemist configuration for the whole `test/` tree.
//
// `flutter_test_config.dart` is picked up automatically by `flutter test` and
// wraps every test in this directory, which is why the golden configuration
// lives here rather than being repeated per file.
//
// ## Why alchemist rather than bare `matchesGoldenFile`
//
// Font rasterisation differs between a local macOS machine and the Ubuntu
// runner CI uses, so a golden authored on one fails on the other by a few
// anti-aliased pixels. Alchemist solves this by splitting goldens in two:
//
//  * **CI goldens** (`goldens/ci/*.png`) — rendered with shadows off and text
//    drawn as opaque blocks rather than glyphs. Nothing platform-specific is
//    rasterised, so the bytes are identical on macOS and Linux. These are the
//    ones committed and the ones CI compares.
//  * **Platform goldens** (`goldens/macos/*.png`) — pixel-accurate, real
//    fonts, useful locally. **Disabled here**: they are not portable, and
//    generating files that only ever pass on one machine invites a CI failure
//    that looks like a regression but is not one.
//
// The trade is explicit: these goldens verify layout, geometry, colour and
// state differences — not glyph shapes. Type is covered instead by the
// behaviour tests, which assert the actual `TextStyle` tokens.
import 'dart:async';

import 'package:alchemist/alchemist.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  return AlchemistConfig.runWithConfig(
    config: const AlchemistConfig(
      platformGoldensConfig: PlatformGoldensConfig(enabled: false),
    ),
    run: testMain,
  );
}
