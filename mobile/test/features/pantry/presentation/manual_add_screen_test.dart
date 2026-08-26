import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/presentation/manual_add_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_pantry_repository.dart';

final PantryItem _existingItem = PantryItem(
  id: 'item-1',
  householdId: 'household-1',
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
  category: 'dal',
  isStaple: true,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

/// Pushes [ManualAddScreen] on top of a placeholder screen, so a test can
/// pop it (via a plain `Navigator`, not go_router — `ManualAddScreen` calls
/// `Navigator.of(context).pop()`, which works identically whether the
/// ancestor `Navigator` belongs to a bare `MaterialApp` or to go_router's
/// own page stack) and assert the placeholder is visible again.
Future<ProviderContainer> _pumpPushed(
  WidgetTester tester, {
  required FakePantryRepository repository,
  String? householdId = 'household-1',
  PantryItem? initialItem,
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
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (BuildContext _) => ManualAddScreen(
                      householdId: householdId ?? 'household-1',
                      initialItem: initialItem,
                    ),
                  ),
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
  return container;
}

void main() {
  group('ManualAddScreen — create mode', () {
    testWidgets('submit is disabled until name, quantity, and unit are valid', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakePantryRepository());

      final Finder submitButton = find.byKey(ManualAddScreen.submitButtonKey);
      expect(tester.widget<PButton>(submitButton).onPressed, isNull);

      await tester.enterText(find.byKey(ManualAddScreen.nameFieldKey), 'Toor Dal');
      await tester.enterText(find.byKey(ManualAddScreen.quantityFieldKey), '2');
      await tester.enterText(find.byKey(ManualAddScreen.unitFieldKey), 'kg');
      await tester.pump();

      expect(tester.widget<PButton>(submitButton).onPressed, isNotNull);
    });

    testWidgets('a blank name keeps submit disabled even with quantity+unit filled', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakePantryRepository());

      await tester.enterText(find.byKey(ManualAddScreen.quantityFieldKey), '2');
      await tester.enterText(find.byKey(ManualAddScreen.unitFieldKey), 'kg');
      await tester.pump();

      expect(
        tester
            .widget<PButton>(find.byKey(ManualAddScreen.submitButtonKey))
            .onPressed,
        isNull,
      );
    });

    testWidgets('success calls addPantryItem and pops back', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        addResult: _existingItem,
      );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(ManualAddScreen.nameFieldKey), 'Toor Dal');
      await tester.enterText(find.byKey(ManualAddScreen.quantityFieldKey), '2');
      await tester.enterText(find.byKey(ManualAddScreen.unitFieldKey), 'kg');
      await tester.pump();
      await tester.tap(find.byKey(ManualAddScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.addCalls, hasLength(1));
      expect(repository.addCalls.single.householdId, 'household-1');
      expect(repository.addCalls.single.draft.name, 'Toor Dal');
      expect(find.byType(ManualAddScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets('a server VALIDATION error renders inline and does not pop', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        addError: const ValidationError('name must not be empty'),
      );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(ManualAddScreen.nameFieldKey), 'Toor Dal');
      await tester.enterText(find.byKey(ManualAddScreen.quantityFieldKey), '2');
      await tester.enterText(find.byKey(ManualAddScreen.unitFieldKey), 'kg');
      await tester.pump();
      await tester.tap(find.byKey(ManualAddScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('name must not be empty'), findsOneWidget);
      expect(find.byType(ManualAddScreen), findsOneWidget);
    });

    testWidgets('cancel (back) mutates nothing', (WidgetTester tester) async {
      final FakePantryRepository repository = FakePantryRepository();
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(ManualAddScreen.nameFieldKey), 'Toor Dal');
      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(repository.addCalls, isEmpty);
      expect(repository.updateCalls, isEmpty);
      expect(find.text('open'), findsOneWidget);
    });
  });

  group('ManualAddScreen — edit mode', () {
    testWidgets('seeds every field from the existing item', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakePantryRepository(),
        initialItem: _existingItem,
      );

      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(ManualAddScreen.nameFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Toor Dal',
      );
    });

    testWidgets('submitting with only one field changed sends a patch with only that field', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        updateResult: _existingItem,
      );
      await _pumpPushed(
        tester,
        repository: repository,
        initialItem: _existingItem,
      );

      await tester.enterText(
        find.byKey(ManualAddScreen.quantityFieldKey),
        '5',
      );
      await tester.tap(find.byKey(ManualAddScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.updateCalls, hasLength(1));
      final patch = repository.updateCalls.single.patch;
      expect(patch.quantity, 5);
      expect(patch.name, isNull);
      expect(patch.unit, isNull);
      expect(patch.category, isNull);
      expect(patch.isStaple, isNull);
    });

    testWidgets('submitting with nothing changed sends no request at all', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        updateResult: _existingItem,
      );
      await _pumpPushed(
        tester,
        repository: repository,
        initialItem: _existingItem,
      );

      await tester.tap(find.byKey(ManualAddScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.updateCalls, isEmpty);
      // Nothing to send is not an error — it just pops, same as a
      // no-op save.
      expect(find.byType(ManualAddScreen), findsNothing);
    });
  });
}
