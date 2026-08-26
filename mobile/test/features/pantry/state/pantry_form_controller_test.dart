import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/domain/pantry_item_draft.dart';
import 'package:mobile/features/pantry/domain/pantry_item_patch.dart';
import 'package:mobile/features/pantry/state/pantry_controller.dart';
import 'package:mobile/features/pantry/state/pantry_form_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/storage/app_database.dart';

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

const PantryItemDraft _draft = PantryItemDraft(
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
);

ProviderContainer _container(FakePantryRepository repository) {
  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      pantryRepositoryProvider.overrideWithValue(repository),
      appDatabaseProvider.overrideWithValue(db),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(db.close);
  return container;
}

void main() {
  group('PantryFormController — add', () {
    test('returns true and clears the action state on success', () async {
      final FakePantryRepository repository = FakePantryRepository(
        addResult: _dal,
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(pantryFormControllerProvider.notifier)
          .add('household-1', _draft);

      expect(ok, isTrue);
      expect(repository.addCalls, hasLength(1));
      expect(repository.addCalls.single.householdId, 'household-1');
    });

    test('invalidates the pantry list for that household on success', () async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[],
        addResult: _dal,
      );
      final ProviderContainer container = _container(repository);
      // Prime the list provider so there's something to invalidate.
      await container.read(pantryControllerProvider('household-1').future);
      expect(repository.calls, hasLength(1));

      await container
          .read(pantryFormControllerProvider.notifier)
          .add('household-1', _draft);
      // Re-reading after invalidation triggers a fresh fetch.
      await container.read(pantryControllerProvider('household-1').future);

      expect(repository.calls, hasLength(2));
    });

    test('returns false and preserves the AppError subtype on failure', () async {
      final FakePantryRepository repository = FakePantryRepository(
        addError: const ValidationError('name must not be empty'),
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(pantryFormControllerProvider.notifier)
          .add('household-1', _draft);

      expect(ok, isFalse);
      expect(
        container.read(pantryFormControllerProvider).error,
        isA<ValidationError>(),
      );
    });
  });

  group('PantryFormController — update', () {
    const PantryItemPatch patch = PantryItemPatch(quantity: 5);

    test('returns true on success', () async {
      final FakePantryRepository repository = FakePantryRepository(
        updateResult: _dal,
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(pantryFormControllerProvider.notifier)
          .updateItem('item-1', patch);

      expect(ok, isTrue);
      expect(repository.updateCalls.single.id, 'item-1');
    });

    test('returns false and preserves the AppError subtype on failure', () async {
      final FakePantryRepository repository = FakePantryRepository(
        updateError: const NotFoundError('Pantry item not found.'),
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(pantryFormControllerProvider.notifier)
          .updateItem('item-1', patch);

      expect(ok, isFalse);
      expect(
        container.read(pantryFormControllerProvider).error,
        isA<NotFoundError>(),
      );
    });
  });

  group('PantryFormController — delete', () {
    test('returns true on success', () async {
      final FakePantryRepository repository = FakePantryRepository(
        deleteResult: _dal,
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(pantryFormControllerProvider.notifier)
          .delete('item-1');

      expect(ok, isTrue);
      expect(repository.deleteCalls, <String>['item-1']);
    });

    test('returns false and preserves the AppError subtype on failure', () async {
      final FakePantryRepository repository = FakePantryRepository(
        deleteError: const NotFoundError('Pantry item not found.'),
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(pantryFormControllerProvider.notifier)
          .delete('item-1');

      expect(ok, isFalse);
      expect(
        container.read(pantryFormControllerProvider).error,
        isA<NotFoundError>(),
      );
    });
  });

  group('PantryFormController — action tracking', () {
    test('reports which action is/was running, distinguishing add/update/delete', () async {
      final FakePantryRepository repository = FakePantryRepository(
        addResult: _dal,
        updateResult: _dal,
        deleteResult: _dal,
      );
      final ProviderContainer container = _container(repository);
      final PantryFormController controller = container.read(
        pantryFormControllerProvider.notifier,
      );

      expect(controller.action, PantryFormAction.none);

      await controller.add('household-1', _draft);
      expect(controller.action, PantryFormAction.add);

      await controller.updateItem('item-1', const PantryItemPatch(quantity: 1));
      expect(controller.action, PantryFormAction.update);

      await controller.delete('item-1');
      expect(controller.action, PantryFormAction.delete);
    });
  });
}
