import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/presentation/add_method_screen.dart';
import 'package:mobile/shared/ui/theme.dart';

void main() {
  group('AddMethodScreen', () {
    testWidgets('the manual option is enabled and calls onManual when tapped', (
      WidgetTester tester,
    ) async {
      bool tapped = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: parimaanTheme(),
          home: AddMethodScreen(onManual: () => tapped = true),
        ),
      );

      await tester.tap(find.byKey(AddMethodScreen.manualButtonKey));
      expect(tapped, isTrue);
    });

    testWidgets('the photo option is disabled', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: parimaanTheme(),
          home: AddMethodScreen(onManual: () {}),
        ),
      );

      final Semantics semantics = tester.widget<Semantics>(
        find.byKey(AddMethodScreen.photoButtonKey),
      );
      expect(semantics.properties.enabled, isFalse);
    });

    testWidgets('the photo option announces "coming soon" to screen readers', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: parimaanTheme(),
          home: AddMethodScreen(onManual: () {}),
        ),
      );

      final Semantics semantics = tester.widget<Semantics>(
        find.byKey(AddMethodScreen.photoButtonKey),
      );
      expect(semantics.properties.label, contains('Coming soon'));
    });
  });
}
