import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
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
  group('JoinHouseholdController — success', () {
    test('joins and parks the household in state', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        joinResult: testHouseholdWithMembers,
      );
      final ProviderContainer container = _container(repository);
      await container.read(joinHouseholdControllerProvider.future);

      final JoinOutcome outcome = await container
          .read(joinHouseholdControllerProvider.notifier)
          .join('K4M9PQ');

      expect(outcome, JoinOutcome.joined);
      expect(
        container.read(joinHouseholdControllerProvider).valueOrNull,
        testHouseholdWithMembers,
      );
    });

    test(
      'passes the raw code through — the repository normalizes it',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          joinResult: testHousehold,
        );
        final ProviderContainer container = _container(repository);
        await container.read(joinHouseholdControllerProvider.future);

        await container
            .read(joinHouseholdControllerProvider.notifier)
            .join('  k4m9pq  ');

        // One normalization, in one place. A second one here could only ever
        // drift from the server's chain.
        expect(repository.joinCalls, <String>['  k4m9pq  ']);
      },
    );

    test('is loading while the join is in flight', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        joinResult: testHousehold,
        delay: const Duration(milliseconds: 20),
      );
      final ProviderContainer container = _container(repository);
      await container.read(joinHouseholdControllerProvider.future);

      final Future<JoinOutcome> pending = container
          .read(joinHouseholdControllerProvider.notifier)
          .join('K4M9PQ');

      expect(container.read(joinHouseholdControllerProvider).isLoading, isTrue);
      await pending;
      expect(
        container.read(joinHouseholdControllerProvider).isLoading,
        isFalse,
      );
    });
  });

  group('JoinHouseholdController — HOUSEHOLD_FULL is routed distinctly', () {
    test(
      'returns JoinOutcome.householdFull, not the generic failure',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          joinError: const HouseholdFullError('This household is full.'),
        );
        final ProviderContainer container = _container(repository);
        await container.read(joinHouseholdControllerProvider.future);

        final JoinOutcome outcome = await container
            .read(joinHouseholdControllerProvider.notifier)
            .join('K4M9PQ');

        expect(outcome, JoinOutcome.householdFull);
      },
    );

    test(
      'keeps the concrete HouseholdFullError in state for the Full screen',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          joinError: const HouseholdFullError('This household is full.'),
        );
        final ProviderContainer container = _container(repository);
        await container.read(joinHouseholdControllerProvider.future);

        await container
            .read(joinHouseholdControllerProvider.notifier)
            .join('K4M9PQ');

        expect(
          container.read(joinHouseholdControllerProvider).error,
          isA<HouseholdFullError>(),
        );
      },
    );

    test(
      'every other AppError is JoinOutcome.failed — only the cap gets its own '
      'screen',
      () async {
        for (final AppError error in <AppError>[
          const NotFoundError('No household has that code.'),
          const RateLimitedError('Too many attempts today.'),
          const ValidationError('inviteCode must be exactly 6 characters'),
          const ForbiddenError('Nope.'),
          const ConflictError('Nope.'),
          const UnauthorizedError('Nope.'),
          const InternalError('Nope.'),
        ]) {
          final FakeHouseholdRepository repository = FakeHouseholdRepository(
            joinError: error,
          );
          final ProviderContainer container = _container(repository);
          await container.read(joinHouseholdControllerProvider.future);

          final JoinOutcome outcome = await container
              .read(joinHouseholdControllerProvider.notifier)
              .join('K4M9PQ');

          expect(
            outcome,
            JoinOutcome.failed,
            reason: '${error.errorType} must not reach the Full screen',
          );
          expect(
            container.read(joinHouseholdControllerProvider).error,
            same(error),
            reason: 'the concrete subtype must survive for the error copy',
          );
        }
      },
    );

    test('never throws — the outcome is the return value', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        joinError: const InternalError('boom'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(joinHouseholdControllerProvider.future);

      await expectLater(
        container.read(joinHouseholdControllerProvider.notifier).join('K4M9PQ'),
        completion(JoinOutcome.failed),
      );
    });
  });

  group('JoinHouseholdController — retry', () {
    test('a retry after a failure clears the stale error', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        joinError: const NotFoundError('No household has that code.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(joinHouseholdControllerProvider.future);

      await container
          .read(joinHouseholdControllerProvider.notifier)
          .join('BADBAD');
      expect(container.read(joinHouseholdControllerProvider).hasError, isTrue);

      repository
        ..joinError = null
        ..joinResult = testHousehold;
      final JoinOutcome outcome = await container
          .read(joinHouseholdControllerProvider.notifier)
          .join('K4M9PQ');

      expect(outcome, JoinOutcome.joined);
      expect(container.read(joinHouseholdControllerProvider).hasError, isFalse);
      expect(
        container.read(joinHouseholdControllerProvider).valueOrNull,
        testHousehold,
      );
    });

    test('starts idle — AsyncData(null), not loading', () async {
      final ProviderContainer container = _container(
        FakeHouseholdRepository(joinResult: testHousehold),
      );

      final Household? initial = await container.read(
        joinHouseholdControllerProvider.future,
      );

      expect(initial, isNull);
      expect(container.read(joinHouseholdControllerProvider).hasError, isFalse);
    });
  });
}
