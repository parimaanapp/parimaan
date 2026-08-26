import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/state/pantry_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_pantry_repository.dart';

final PantryItem _dal = PantryItem(
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

ProviderContainer _container(FakePantryRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[pantryRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('PantryController — build', () {
    test('fetches the household it is keyed on, unfiltered', () async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      final ProviderContainer container = _container(repository);

      final List<PantryItem> items = await container.read(
        pantryControllerProvider('household-1').future,
      );

      expect(items, <PantryItem>[_dal]);
      expect(repository.calls, <({String householdId, String? search, String? category})>[
        (householdId: 'household-1', search: null, category: null),
      ]);
    });

    test('two ids are independent caches, not one shared slot', () async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      final ProviderContainer container = _container(repository);

      await container.read(pantryControllerProvider('a').future);
      await container.read(pantryControllerProvider('b').future);

      expect(
        repository.calls.map((c) => c.householdId),
        <String>['a', 'b'],
      );
    });

    test('is in a loading state before the fetch resolves', () async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
        delay: const Duration(milliseconds: 20),
      );
      final ProviderContainer container = _container(repository);

      final AsyncValue<List<PantryItem>> initial = container.read(
        pantryControllerProvider('household-1'),
      );
      expect(initial, isA<AsyncLoading<List<PantryItem>>>());

      await container.read(pantryControllerProvider('household-1').future);
      expect(
        container.read(pantryControllerProvider('household-1')),
        isA<AsyncData<List<PantryItem>>>(),
      );
    });

    test('a fetch failure lands in state with its concrete AppError subtype', () async {
      final FakePantryRepository repository = FakePantryRepository(
        error: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(pantryControllerProvider('household-1').future),
        throwsA(isA<ForbiddenError>()),
      );
      expect(
        container.read(pantryControllerProvider('household-1')).error,
        isA<ForbiddenError>(),
      );
    });
  });

  group('PantryController — setCategory', () {
    test('refetches immediately with the category filter, no debounce', () async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      final ProviderContainer container = _container(repository);
      await container.read(pantryControllerProvider('household-1').future);

      await container
          .read(pantryControllerProvider('household-1').notifier)
          .setCategory('dal');

      expect(repository.calls.last.category, 'dal');
    });

    test('a failed category refetch keeps the last good list on screen', () async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      final ProviderContainer container = _container(repository);
      await container.read(pantryControllerProvider('household-1').future);

      repository.error = const InternalError('network down');
      await container
          .read(pantryControllerProvider('household-1').notifier)
          .setCategory('dal');

      final AsyncValue<List<PantryItem>> state = container.read(
        pantryControllerProvider('household-1'),
      );
      expect(state.hasError, isTrue);
      expect(state.valueOrNull, <PantryItem>[_dal]);
    });
  });

  group('PantryController — setSearch (debounced)', () {
    test(
      'does not refetch until the debounce settles',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          result: <PantryItem>[_dal],
        );
        final ProviderContainer container = _container(repository);
        await container.read(pantryControllerProvider('household-1').future);

        container
            .read(pantryControllerProvider('household-1').notifier)
            .setSearch('d');

        // Still just the one build()-time call — nothing fired synchronously.
        expect(repository.calls, hasLength(1));
      },
    );

    test(
      'refetches with the search filter once the debounce settles',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          result: <PantryItem>[_dal],
        );
        final ProviderContainer container = _container(repository);
        await container.read(pantryControllerProvider('household-1').future);

        container
            .read(pantryControllerProvider('household-1').notifier)
            .setSearch('dal');

        await Future<void>.delayed(const Duration(milliseconds: 500));

        expect(repository.calls.last.search, 'dal');
      },
    );
  });

  group('PantryController — surviving a second build()', () {
    test(
      'ref.invalidate followed by a re-read does not throw — a rebuilt '
      'instance must be able to set up its own SearchDebouncer again',
      () async {
        final FakePantryRepository repository = FakePantryRepository(
          result: <PantryItem>[_dal],
        );
        final ProviderContainer container = _container(repository);
        await container.read(pantryControllerProvider('household-1').future);

        container.invalidate(pantryControllerProvider('household-1'));

        await expectLater(
          container.read(pantryControllerProvider('household-1').future),
          completes,
        );
        expect(repository.calls, hasLength(2));
      },
    );
  });
}
