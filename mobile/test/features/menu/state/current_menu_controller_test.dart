import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/state/current_menu_controller.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_menu_repository.dart';
import '../../../support/menu_fixtures.dart';

ProviderContainer _container(FakeMenuRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[menuRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  final MenuKey key = menuKeyFor('household-1', DateTime.utc(2026, 9, 7));

  group('menuKeyFor', () {
    test('normalizes any time-of-day/timezone to UTC midnight — a local-time and a UTC DateTime for the same calendar day produce the SAME key', () {
      final MenuKey fromUtc = menuKeyFor(
        'household-1',
        DateTime.utc(2026, 9, 7, 13, 45),
      );
      final MenuKey fromLocal = menuKeyFor(
        'household-1',
        DateTime(2026, 9, 7, 23, 59, 59),
      );

      expect(fromUtc, key);
      expect(fromLocal, key);
    });
  });

  group('CurrentMenuController — build', () {
    test('asserts when given a non-canonical MenuKey — a raw record literal built by hand rather than menuKeyFor()', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
      );
      final ProviderContainer container = _container(repository);
      final MenuKey nonCanonical = (
        householdId: 'household-1',
        weekStartDate: DateTime(2026, 9, 7),
      );

      await expectLater(
        container.read(currentMenuControllerProvider(nonCanonical).future),
        throwsA(isA<AssertionError>()),
      );
    });

    test('returns the existing menu when fetchMenu finds one — never calls createMenu', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
      );
      final ProviderContainer container = _container(repository);

      final Menu result = await container.read(
        currentMenuControllerProvider(key).future,
      );

      expect(result, testMenuWithItems);
      expect(repository.fetchCalls, hasLength(1));
      expect(repository.createCalls, isEmpty);
    });

    test(
      'falls back to createMenu when fetchMenu finds none — a fresh week',
      () async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: null,
          createResult: testEmptyMenu,
        );
        final ProviderContainer container = _container(repository);

        final Menu result = await container.read(
          currentMenuControllerProvider(key).future,
        );

        expect(result, testEmptyMenu);
        expect(repository.fetchCalls, hasLength(1));
        expect(repository.createCalls, hasLength(1));
      },
    );

    test('the get-or-create convenience is idempotent: a repeat build+refresh for the same key still lands on the same menu id', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: null,
        createResult: testEmptyMenu,
      );
      final ProviderContainer container = _container(repository);

      final Menu first = await container.read(
        currentMenuControllerProvider(key).future,
      );
      await container
          .read(currentMenuControllerProvider(key).notifier)
          .refresh();
      final Menu second = container
          .read(currentMenuControllerProvider(key))
          .requireValue;

      expect(second.id, first.id);
    });

    test('two weeks for the same household are independent caches', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
      );
      final ProviderContainer container = _container(repository);

      final MenuKey weekOne = menuKeyFor(
        'household-1',
        DateTime.utc(2026, 9, 7),
      );
      final MenuKey weekTwo = menuKeyFor(
        'household-1',
        DateTime.utc(2026, 9, 14),
      );

      await container.read(currentMenuControllerProvider(weekOne).future);
      await container.read(currentMenuControllerProvider(weekTwo).future);

      expect(repository.fetchCalls, hasLength(2));
      expect(repository.fetchCalls[0].$2, DateTime.utc(2026, 9, 7));
      expect(repository.fetchCalls[1].$2, DateTime.utc(2026, 9, 14));
    });

    test('a refresh() failure after a successful build preserves the last good menu (copyWithPrevious)', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
        fetchErrorFromCall: 2,
        fetchError: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      await container
          .read(currentMenuControllerProvider(key).notifier)
          .refresh();

      final AsyncValue<Menu> state = container.read(
        currentMenuControllerProvider(key),
      );
      expect(state.hasError, isTrue);
      expect(state.value, testMenuWithItems);
    });

    test('a fetch failure lands in state with its concrete subtype', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchError: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(currentMenuControllerProvider(key).future),
        throwsA(isA<ForbiddenError>()),
      );
    });
  });

  group('CurrentMenuController.addMenuItem', () {
    test(
      'adds against the current menu id, then refreshes from the server',
      () async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
          addResult: testMenuItem,
        );
        final ProviderContainer container = _container(repository);
        await container.read(currentMenuControllerProvider(key).future);

        final NewMenuItem draft = NewMenuItem(
          recipeId: 'recipe-1',
          dayOfWeek: 0,
          mealSlot: 'lunch',
          slotRole: RecipeRole.sabziDal,
        );
        await container
            .read(currentMenuControllerProvider(key).notifier)
            .addMenuItem(draft);

        expect(repository.addCalls, hasLength(1));
        expect(repository.addCalls.single.$1, testEmptyMenu.id);
        expect(repository.addCalls.single.$2, draft);
        // Refreshed: fetchMenu called again after the add.
        expect(repository.fetchCalls, hasLength(2));
      },
    );

    test('the mutation succeeding but the follow-up refresh failing still throws — never silently reported as success', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        addResult: testMenuItem,
        fetchErrorFromCall: 2,
        fetchError: const InternalError('refresh failed'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      // The add itself succeeded (addCalls will show it below) — only the
      // POST-add refresh fails, and that failure must still surface to the
      // caller rather than addMenuItem returning as if all is well.
      await expectLater(
        container
            .read(currentMenuControllerProvider(key).notifier)
            .addMenuItem(
              NewMenuItem(
                recipeId: 'recipe-1',
                dayOfWeek: 0,
                mealSlot: 'lunch',
                slotRole: RecipeRole.sabziDal,
              ),
            ),
        throwsA(isA<InternalError>()),
      );
      expect(repository.addCalls, hasLength(1));
    });

    test('a cap-rejection throws — the caller must see it, not a swallowed failure', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        addError: const ConflictError('This meal slot is full.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      await expectLater(
        container
            .read(currentMenuControllerProvider(key).notifier)
            .addMenuItem(
              NewMenuItem(
                recipeId: 'recipe-1',
                dayOfWeek: 0,
                mealSlot: 'lunch',
                slotRole: RecipeRole.sabziDal,
              ),
            ),
        throwsA(isA<ConflictError>()),
      );
    });
  });

  group('CurrentMenuController.removeMenuItem', () {
    test('removes by id, then refreshes from the server', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      await container
          .read(currentMenuControllerProvider(key).notifier)
          .removeMenuItem('menu-item-1');

      expect(repository.removeCalls, <String>['menu-item-1']);
      expect(repository.fetchCalls, hasLength(2));
    });
  });

  group('CurrentMenuController.markMade', () {
    test('marks the item made by id, then refreshes from the server — the item\'s madeAt is visible after refresh', () async {
      final MenuItem madeItem = MenuItem(
        id: 'menu-item-1',
        menuId: 'menu-1',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.sabziDal,
        madeAt: DateTime.utc(2026, 9, 4, 12),
      );
      final Menu menuAfterMade = Menu(
        id: 'menu-1',
        householdId: 'household-1',
        weekStartDate: DateTime.utc(2026, 9, 7),
        items: <MenuItem>[madeItem],
      );
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
        markMadeResult: madeItem,
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);
      // The second fetchMenu call (the post-markMade refresh) returns the
      // menu with the item now made.
      repository.fetchResult = menuAfterMade;

      await container
          .read(currentMenuControllerProvider(key).notifier)
          .markMade('menu-item-1');

      expect(repository.markMadeCalls, <String>['menu-item-1']);
      // Refreshed: fetchMenu called again after the mark-made call.
      expect(repository.fetchCalls, hasLength(2));
      expect(
        container
            .read(currentMenuControllerProvider(key))
            .requireValue
            .items
            .single
            .madeAt,
        isNotNull,
      );
    });

    test(
      'a rejection throws — the caller must see it, never swallowed',
      () async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
          markMadeError: const ConflictError('This item was already made.'),
        );
        final ProviderContainer container = _container(repository);
        await container.read(currentMenuControllerProvider(key).future);

        await expectLater(
          container
              .read(currentMenuControllerProvider(key).notifier)
              .markMade('menu-item-1'),
          throwsA(isA<ConflictError>()),
        );
      },
    );

    test(
      'the mutation succeeding but the follow-up refresh failing still throws',
      () async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
          markMadeResult: testMenuItem,
          fetchErrorFromCall: 2,
          fetchError: const InternalError('refresh failed'),
        );
        final ProviderContainer container = _container(repository);
        await container.read(currentMenuControllerProvider(key).future);

        await expectLater(
          container
              .read(currentMenuControllerProvider(key).notifier)
              .markMade('menu-item-1'),
          throwsA(isA<InternalError>()),
        );
        expect(repository.markMadeCalls, hasLength(1));
      },
    );
  });

  group('CurrentMenuController.previewAutoFill', () {
    test('previews against the current menu id and returns the proposal — mutates NOTHING in state', () async {
      final AutoFillPreviewResult preview = AutoFillPreviewResult(
        items: <ProposedMenuItem>[
          ProposedMenuItem(
            recipeId: 'recipe-1',
            recipe: testMenuRecipe,
            dayOfWeek: 0,
            mealSlot: 'lunch',
            slotRole: RecipeRole.sabziDal,
          ),
        ],
        filledCount: 1,
        unfilledSlots: const <UnfilledSlot>[],
      );
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: preview,
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      final AutoFillPreviewResult result = await container
          .read(currentMenuControllerProvider(key).notifier)
          .previewAutoFill();

      expect(result, preview);
      expect(repository.previewCalls, <String>[testEmptyMenu.id]);
      // No refresh, no state change — a pure read.
      expect(repository.fetchCalls, hasLength(1));
      expect(
        container.read(currentMenuControllerProvider(key)).requireValue,
        testEmptyMenu,
      );
    });

    test('a preview failure throws — the caller must see it', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewError: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      await expectLater(
        container
            .read(currentMenuControllerProvider(key).notifier)
            .previewAutoFill(),
        throwsA(isA<ForbiddenError>()),
      );
    });

    test('calling twice produces two independent network calls — no caching of a proposal', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);
      final CurrentMenuController notifier = container.read(
        currentMenuControllerProvider(key).notifier,
      );

      await notifier.previewAutoFill();
      await notifier.previewAutoFill();

      expect(repository.previewCalls, hasLength(2));
    });
  });

  group('CurrentMenuController.commitAutoFill', () {
    test('commits against the current menu id and sets state directly from the result — no extra refresh round trip', () async {
      final AutoFillResult commitResult = AutoFillResult(
        menu: testMenuWithItems,
        filledCount: 1,
        unfilledSlots: const <UnfilledSlot>[],
      );
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        autoFillResult: commitResult,
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      final NewMenuItem draft = NewMenuItem(
        recipeId: 'recipe-1',
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.sabziDal,
      );
      final AutoFillResult result = await container
          .read(currentMenuControllerProvider(key).notifier)
          .commitAutoFill(overwrite: true, items: <NewMenuItem>[draft]);

      expect(result, commitResult);
      expect(repository.autoFillCalls, hasLength(1));
      expect(repository.autoFillCalls.single.$1, testEmptyMenu.id);
      expect(repository.autoFillCalls.single.$2, isTrue);
      expect(repository.autoFillCalls.single.$3, <NewMenuItem>[draft]);
      // State updated directly from the result's own menu — fetchMenu is
      // NOT called again (unlike addMenuItem/removeMenuItem's refresh()).
      expect(repository.fetchCalls, hasLength(1));
      expect(
        container.read(currentMenuControllerProvider(key)).requireValue,
        testMenuWithItems,
      );
    });

    test('a commit failure throws — the caller must see it, state is left unchanged', () async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        autoFillError: const ConflictError('This meal slot is full.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(currentMenuControllerProvider(key).future);

      await expectLater(
        container
            .read(currentMenuControllerProvider(key).notifier)
            .commitAutoFill(overwrite: false, items: const <NewMenuItem>[]),
        throwsA(isA<ConflictError>()),
      );
      expect(
        container.read(currentMenuControllerProvider(key)).requireValue,
        testEmptyMenu,
      );
    });
  });
}
