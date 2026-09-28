import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/presentation/pantry_photo_capture_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

/// W19 §26.1 — this test environment has no real camera platform channel
/// registered, and an unmocked `availableCameras()` call simply never
/// resolves here (found empirically — not a clean, testable rejection),
/// rather than throwing quickly. So these tests cover only the screen's
/// permanent "still initializing" state, which every real launch also
/// passes through — genuinely real coverage, just not the full state
/// space. The error-fallback path (`_CameraUnavailable`) and everything
/// past a real `CameraController` (live preview, brightness sampling,
/// actual capture) need a real device/simulator pass, exactly as this
/// screen's own doc comment already says — not claimed here.
Future<void> _pump(
  WidgetTester tester, {
  required ValueChanged<Uint8List> onCaptured,
  VoidCallback? onBack,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: PantryPhotoCaptureScreen(onCaptured: onCaptured, onBack: onBack),
    ),
  );
  await tester.pump();
}

void main() {
  group('PantryPhotoCaptureScreen — camera still initializing', () {
    testWidgets('shows a loading indicator, not a blank or crashed screen', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onCaptured: (_) {});

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('the shutter button is disabled until a controller exists', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onCaptured: (_) {});

      final PButton button = tester.widget<PButton>(
        find.byKey(PantryPhotoCaptureScreen.shutterButtonKey),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('the back control is reachable and calls onBack even while still initializing', (
      WidgetTester tester,
    ) async {
      int backTaps = 0;
      await _pump(tester, onCaptured: (_) {}, onBack: () => backTaps++);

      await tester.tap(find.byKey(PantryPhotoCaptureScreen.backButtonKey));
      await tester.pump();

      expect(backTaps, 1);
    });

    testWidgets('onCaptured is never called without a real capture happening', (
      WidgetTester tester,
    ) async {
      int captures = 0;
      await _pump(tester, onCaptured: (_) => captures++);

      expect(captures, 0);
    });

    testWidgets('disposing mid-initialization does not throw', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onCaptured: (_) {});

      await tester.pumpWidget(const SizedBox.shrink());

      expect(tester.takeException(), isNull);
    });
  });
}
