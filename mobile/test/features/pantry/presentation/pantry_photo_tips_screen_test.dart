import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/presentation/pantry_photo_tips_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

Future<void> _pump(
  WidgetTester tester, {
  required VoidCallback onContinue,
  VoidCallback? onBack,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: PantryPhotoTipsScreen(onContinue: onContinue, onBack: onBack),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('PantryPhotoTipsScreen', () {
    // W19 §26.1 — exactly the three tips locked in that section, each one
    // line, combining "one shelf per photo" with "keep everything on it in
    // view" per the founder's own explicit call (not two separate tips).
    testWidgets('shows exactly the three locked tips', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onContinue: () {});

      expect(
        find.text('One shelf per photo — keep everything on it in view'),
        findsOneWidget,
      );
      expect(find.text('Turn labels to face the camera'), findsOneWidget);
      expect(
        find.text('Good light — turn on a light or use flash in dark cabinets'),
        findsOneWidget,
      );
    });

    testWidgets('does not mention opaque containers — a quiet fallback, not a pre-camera tip', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onContinue: () {});

      expect(find.textContaining('opaque'), findsNothing);
    });

    testWidgets('tapping the continue action calls onContinue exactly once', (
      WidgetTester tester,
    ) async {
      int continueTaps = 0;
      await _pump(tester, onContinue: () => continueTaps++);

      expect(find.byKey(PantryPhotoTipsScreen.continueButtonKey), findsOneWidget);
      await tester.tap(find.byKey(PantryPhotoTipsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(continueTaps, 1);
    });

    testWidgets('the back button calls onBack when provided', (
      WidgetTester tester,
    ) async {
      int backTaps = 0;
      await _pump(tester, onContinue: () {}, onBack: () => backTaps++);

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(backTaps, 1);
    });
  });
}
