import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/presentation/recipe_picker_stub_screen.dart';

void main() {
  group('RecipePickerStubScreen', () {
    testWidgets('renders a real empty state, not a dead end', (
      WidgetTester tester,
    ) async {
      bool backCalled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: RecipePickerStubScreen(onBack: () => backCalled = true),
        ),
      );

      expect(find.byKey(RecipePickerStubScreen.emptyStateKey), findsOneWidget);
      expect(find.text('Coming soon'), findsOneWidget);

      await tester.tap(find.text('Back to weekly plan').last);
      expect(backCalled, isTrue);
    });
  });
}
