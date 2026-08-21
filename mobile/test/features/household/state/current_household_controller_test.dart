import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/features/household/state/join_household_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

ProviderContainer _container(FakeHouseholdRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('CurrentHouseholdController — build', () {
    test('fetches the household it is keyed on', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        fetchResult: testHouseholdWithMembers,
      );
      final ProviderContainer container = _container(repository);

      final Household household = await container.read(
        currentHouseholdControllerProvider('household-1').future,
      );

      expect(household, testHouseholdWithMembers);
      expect(repository.fetchCalls, <String>['household-1']);
    });

    test('two ids are independent caches, not one shared slot', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        fetchResult: testHousehold,
      );
      final ProviderContainer container = _container(repository);

      await container.read(currentHouseholdControllerProvider('a').future);
      await container.read(currentHouseholdControllerProvider('b').future);

      expect(repository.fetchCalls, <String>['a', 'b']);
    });

    test('a fetch failure lands in state with its concrete subtype', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        fetchError: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(
          currentHouseholdControllerProvider('household-1').future,
        ),
        throwsA(isA<ForbiddenError>()),
      );
      expect(
        container.read(currentHouseholdControllerProvider('household-1')).error,
        isA<ForbiddenError>(),
      );
    });
  });

  group('CurrentHouseholdController — refresh', () {
    test('re-reads from the server', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        fetchResult: testHousehold,
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentHouseholdControllerProvider('household-1').future,
      );

      await container
          .read(currentHouseholdControllerProvider('household-1').notifier)
          .refresh();

      expect(repository.fetchCalls, <String>['household-1', 'household-1']);
    });

    test('surfaces the newer roster', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        fetchResult: testHousehold,
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentHouseholdControllerProvider('household-1').future,
      );

      repository.fetchResult = testHouseholdWithMembers;
      await container
          .read(currentHouseholdControllerProvider('household-1').notifier)
          .refresh();

      expect(
        container
            .read(currentHouseholdControllerProvider('household-1'))
            .valueOrNull!
            .members,
        hasLength(4),
      );
    });

    test(
      'a failed refresh keeps the last good household on screen — a poll that '
      'blanks the screen it was refreshing is worse than one that fails',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          fetchResult: testHouseholdWithMembers,
        );
        final ProviderContainer container = _container(repository);
        await container.read(
          currentHouseholdControllerProvider('household-1').future,
        );

        repository.fetchError = const InternalError('network down');
        await container
            .read(currentHouseholdControllerProvider('household-1').notifier)
            .refresh();

        final AsyncValue<Household> state = container.read(
          currentHouseholdControllerProvider('household-1'),
        );
        expect(state.hasError, isTrue);
        expect(state.valueOrNull, testHouseholdWithMembers);
      },
    );

    test(
      'never throws, even though the poll timer cannot catch anything',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          fetchResult: testHousehold,
        );
        final ProviderContainer container = _container(repository);
        await container.read(
          currentHouseholdControllerProvider('household-1').future,
        );

        repository.fetchError = const InternalError('boom');

        await expectLater(
          container
              .read(currentHouseholdControllerProvider('household-1').notifier)
              .refresh(),
          completes,
        );
      },
    );
  });

  group('activeHouseholdProvider — the Query.me stopgap', () {
    test('is null when nothing has been created or joined this session', () {
      final ProviderContainer container = _container(
        FakeHouseholdRepository(result: testHousehold),
      );

      expect(container.read(activeHouseholdProvider), isNull);
    });

    test('reports the household the wizard created', () async {
      final ProviderContainer container = _container(
        FakeHouseholdRepository(result: testHousehold),
      );
      await container.read(householdWizardControllerProvider.future);

      container
          .read(householdWizardControllerProvider.notifier)
          .adoptHousehold(testHousehold);

      expect(container.read(activeHouseholdProvider), testHousehold);
    });

    test('reports the household the join flow joined', () async {
      final ProviderContainer container = _container(
        FakeHouseholdRepository(joinResult: testHouseholdWithMembers),
      );
      await container.read(joinHouseholdControllerProvider.future);

      await container
          .read(joinHouseholdControllerProvider.notifier)
          .join('K4M9PQ');

      expect(container.read(activeHouseholdProvider), testHouseholdWithMembers);
    });

    test('prefers a joined household over a wizard draft', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
        joinResult: testHouseholdWithMembers,
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdWizardControllerProvider.future);
      await container.read(joinHouseholdControllerProvider.future);

      container
          .read(householdWizardControllerProvider.notifier)
          .adoptHousehold(testHousehold);
      await container
          .read(joinHouseholdControllerProvider.notifier)
          .join('K4M9PQ');

      // The join is the more recent statement of intent, and the wizard draft
      // may be a half-finished household the user walked away from.
      expect(container.read(activeHouseholdProvider), testHouseholdWithMembers);
    });
  });
}
