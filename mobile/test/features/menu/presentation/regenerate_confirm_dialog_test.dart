import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/presentation/regenerate_confirm_dialog.dart';
import 'package:mobile/shared/ui/theme.dart';

Future<ValueNotifier<bool?>> _pump(
  WidgetTester tester, {
  required int unmadeItemCount,
}) async {
  final ValueNotifier<bool?> result = ValueNotifier<bool?>(null);
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: ElevatedButton(
              onPressed: () async {
                result.value = await showRegenerateConfirmDialog(
                  context: context,
                  unmadeItemCount: unmadeItemCount,
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return result;
}

void main() {
  group('RegenerateConfirmDialog', () {
    testWidgets('states plainly that manually-placed items are replaced too, and that made meals are kept', (
      WidgetTester tester,
    ) async {
      await _pump(tester, unmadeItemCount: 3);

      expect(find.textContaining('including ones you picked yourself'), findsOneWidget);
      expect(find.textContaining('not just earlier auto-fill picks'), findsOneWidget);
      expect(find.textContaining('Meals already marked made are always kept'), findsOneWidget);
    });

    testWidgets('names the unmade item count', (WidgetTester tester) async {
      await _pump(tester, unmadeItemCount: 5);

      expect(find.text('Replace 5 planned items?'), findsOneWidget);
    });

    testWidgets('singular copy for exactly one unmade item', (WidgetTester tester) async {
      await _pump(tester, unmadeItemCount: 1);

      expect(find.text('Replace 1 planned item?'), findsOneWidget);
    });

    testWidgets('Cancel calls nothing and resolves false', (WidgetTester tester) async {
      final ValueNotifier<bool?> result = await _pump(tester, unmadeItemCount: 2);

      await tester.tap(find.byKey(RegenerateConfirmDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(result.value, isFalse);
      expect(find.byType(RegenerateConfirmDialog), findsNothing);
    });

    testWidgets('Replace resolves true', (WidgetTester tester) async {
      final ValueNotifier<bool?> result = await _pump(tester, unmadeItemCount: 2);

      await tester.tap(find.byKey(RegenerateConfirmDialog.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(result.value, isTrue);
      expect(find.byType(RegenerateConfirmDialog), findsNothing);
    });
  });
}
