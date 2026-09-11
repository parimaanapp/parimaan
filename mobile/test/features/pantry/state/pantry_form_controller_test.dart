import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/curated_pantry_selection.dart';
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

  group('PantryFormController — bulkAdd', () {
    const List<CuratedPantrySelection> selections = <CuratedPantrySelection>[
      CuratedPantrySelection(name: 'Toor Dal', quantity: 2, unit: 'kg'),
      CuratedPantrySelection(name: 'Moong Dal', quantity: 1, unit: 'kg'),
    ];

    test(
      'issues exactly one bulkAddPantryItems call carrying every selection, '
      'never N single addPantryItem calls',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          bulkAddResult: <PantryItem>[_dal],
        );
        final ProviderContainer container = _container(repository);

        final bool ok = await container
            .read(pantryFormControllerProvider.notifier)
            .bulkAdd('household-1', selections);

        expect(ok, isTrue);
        expect(repository.bulkAddCalls, hasLength(1));
        expect(repository.bulkAddCalls.single.householdId, 'household-1');
        expect(repository.bulkAddCalls.single.items, hasLength(2));
        expect(repository.addCalls, isEmpty);
      },
    );

    test(
      'each item carries the name and the quantity/unit from its own selection',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          bulkAddResult: <PantryItem>[_dal],
        );
        final ProviderContainer container = _container(repository);

        await container
            .read(pantryFormControllerProvider.notifier)
            .bulkAdd('household-1', selections);

        final List<PantryItemDraft> sent = repository.bulkAddCalls.single.items;
        expect(sent[0].name, 'Toor Dal');
        expect(sent[0].quantity, 2);
        expect(sent[0].unit, 'kg');
        expect(sent[1].name, 'Moong Dal');
        expect(sent[1].quantity, 1);
        expect(sent[1].unit, 'kg');
      },
    );

    test(
      'a failure surfaces as a typed AppError and never half-invalidates the list',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          result: <PantryItem>[],
          bulkAddError: const NotFoundError('Household not found.'),
        );
        final ProviderContainer container = _container(repository);
        await container.read(pantryControllerProvider('household-1').future);
        expect(repository.calls, hasLength(1));

        final bool ok = await container
            .read(pantryFormControllerProvider.notifier)
            .bulkAdd('household-1', selections);

        expect(ok, isFalse);
        expect(
          container.read(pantryFormControllerProvider).error,
          isA<NotFoundError>(),
        );
        // No invalidation on failure — the cached list is never touched by
        // a half-applied commit.
        await container.read(pantryControllerProvider('household-1').future);
        expect(repository.calls, hasLength(1));
      },
    );

    test(
      'a failed selection can be resent unmodified and succeed on retry',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          bulkAddError: const NotFoundError('Household not found.'),
        );
        final ProviderContainer container = _container(repository);
        final PantryFormController controller = container.read(
          pantryFormControllerProvider.notifier,
        );

        final bool first = await controller.bulkAdd('household-1', selections);
        expect(first, isFalse);

        repository.bulkAddError = null;
        repository.bulkAddResult = <PantryItem>[_dal];
        final bool second = await controller.bulkAdd('household-1', selections);

        expect(second, isTrue);
        expect(repository.bulkAddCalls, hasLength(2));
        // `PantryItemDraft` has no `==` override, so the retry's freshly
        // built drafts are never the *same instances* as the first
        // attempt's — comparing field-by-field is what "resent unmodified"
        // actually means here, not list/object identity.
        final List<PantryItemDraft> firstItems = repository.bulkAddCalls[0].items;
        final List<PantryItemDraft> secondItems = repository.bulkAddCalls[1].items;
        expect(secondItems, hasLength(firstItems.length));
        for (int i = 0; i < firstItems.length; i++) {
          expect(secondItems[i].name, firstItems[i].name);
          expect(secondItems[i].quantity, firstItems[i].quantity);
          expect(secondItems[i].unit, firstItems[i].unit);
        }
      },
    );

    test(
      'a selection over the 50-item cap is refused client-side with a '
      'ValidationError, never truncated, and never reaches the repository',
      () async {
        final FakePantryRepository repository = FakePantryRepository();
        final ProviderContainer container = _container(repository);
        final List<CuratedPantrySelection> tooMany = List<CuratedPantrySelection>.generate(
          51,
          (int i) => CuratedPantrySelection(
            name: 'Item $i',
            quantity: 1,
            unit: 'kg',
          ),
        );

        final bool ok = await container
            .read(pantryFormControllerProvider.notifier)
            .bulkAdd('household-1', tooMany);

        expect(ok, isFalse);
        expect(
          container.read(pantryFormControllerProvider).error,
          isA<ValidationError>(),
        );
        expect(repository.bulkAddCalls, isEmpty);
      },
    );

    test(
      'refreshes the pantry list via the controller\'s own refetch on '
      'success, not via a push (the inherited D7 gap is deliberate)',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          result: <PantryItem>[],
          bulkAddResult: <PantryItem>[_dal],
        );
        final ProviderContainer container = _container(repository);
        await container.read(pantryControllerProvider('household-1').future);
        expect(repository.calls, hasLength(1));
        // `PantryController.build` itself subscribes to
        // `watchPantryChanges` unconditionally (W8 S8, pre-existing,
        // unrelated to this slice) — so `watchCalls` is never empty once
        // the controller has built even once. What distinguishes "refetch
        // via invalidate" from "refetch via a push" is that the fake's
        // stream for this household is never fed a value below — `calls`
        // (the actual `fetchPantry` count) tracks 1:1 with explicit
        // builds, not with anything arriving over that stream.
        expect(repository.watchCalls, hasLength(1));

        await container
            .read(pantryFormControllerProvider.notifier)
            .bulkAdd('household-1', selections);
        await container.read(pantryControllerProvider('household-1').future);

        // `ref.invalidate` disposes and rebuilds the controller, which is
        // why `watchCalls` grows too (a fresh subscription on the fresh
        // instance) — the signal for "not a push" is `calls` advancing by
        // exactly one per build, never more than the number of builds.
        expect(repository.calls, hasLength(2));
        expect(repository.watchCalls, hasLength(2));
      },
    );
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
    test(
      'reports which action is/was running, distinguishing add/bulkAdd/update/delete',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          addResult: _dal,
          bulkAddResult: <PantryItem>[_dal],
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

        await controller.bulkAdd('household-1', const <CuratedPantrySelection>[
          CuratedPantrySelection(name: 'Toor Dal', quantity: 2, unit: 'kg'),
        ]);
        expect(controller.action, PantryFormAction.bulkAdd);

        await controller.updateItem('item-1', const PantryItemPatch(quantity: 1));
        expect(controller.action, PantryFormAction.update);

        await controller.delete('item-1');
        expect(controller.action, PantryFormAction.delete);
      },
    );
  });
}
