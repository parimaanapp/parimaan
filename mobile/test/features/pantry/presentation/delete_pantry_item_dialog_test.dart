import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/presentation/delete_pantry_item_dialog.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_pantry_repository.dart';

final PantryItem _dal = PantryItem(
  id: 'item-1',
  householdId: 'household-1',
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
  isStaple: false,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

Future<void> _pumpAndOpen(
  WidgetTester tester, {
  required FakePantryRepository repository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[pantryRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => showDeletePantryItemDialog(
                  context: context,
                  item: _dal,
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('showDeletePantryItemDialog', () {
    testWidgets('cancel closes the dialog and deletes nothing', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository();
      await _pumpAndOpen(tester, repository: repository);

      await tester.tap(find.byKey(DeletePantryItemDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(repository.deleteCalls, isEmpty);
      expect(find.byType(DeletePantryItemDialog), findsNothing);
    });

    testWidgets('confirm calls deletePantryItem and closes the dialog', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        deleteResult: _dal,
      );
      await _pumpAndOpen(tester, repository: repository);
      await tester.tap(find.byKey(DeletePantryItemDialog.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(repository.deleteCalls, <String>['item-1']);
      expect(find.byType(DeletePantryItemDialog), findsNothing);
    });

    testWidgets('a failure keeps the dialog open with the server message', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        deleteError: const NotFoundError('Pantry item not found.'),
      );
      await _pumpAndOpen(tester, repository: repository);

      await tester.tap(find.byKey(DeletePantryItemDialog.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(DeletePantryItemDialog), findsOneWidget);
      expect(find.text('Pantry item not found.'), findsOneWidget);
    });
  });
}
