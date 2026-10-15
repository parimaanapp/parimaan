import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/create_household_controller.dart';
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
  group('CreateHouseholdController', () {
    test('starts idle — no household, no loading, no error', () async {
      final ProviderContainer container = _container(
        FakeHouseholdRepository(result: testHousehold),
      );

      await container.read(createHouseholdControllerProvider.future);

      final AsyncValue<Household?> state = container.read(
        createHouseholdControllerProvider,
      );
      expect(state.hasValue, isTrue);
      expect(state.value, isNull);
      expect(state.isLoading, isFalse);
    });

    test(
      'does not touch the repository until createHousehold is called',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          result: testHousehold,
        );
        final ProviderContainer container = _container(repository);

        await container.read(createHouseholdControllerProvider.future);

        expect(repository.calls, isEmpty);
      },
    );

    test('goes loading then data on success', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
        delay: const Duration(milliseconds: 10),
      );
      final ProviderContainer container = _container(repository);
      await container.read(createHouseholdControllerProvider.future);

      final List<AsyncValue<Household?>> observed = <AsyncValue<Household?>>[];
      container.listen<AsyncValue<Household?>>(
        createHouseholdControllerProvider,
        (AsyncValue<Household?>? _, AsyncValue<Household?> next) =>
            observed.add(next),
      );

      await container
          .read(createHouseholdControllerProvider.notifier)
          .createHousehold('Kulkarni Kitchen');

      expect(observed.first.isLoading, isTrue);
      expect(observed.last.value, testHousehold);
      expect(repository.calls, <String>['Kulkarni Kitchen']);
    });

    test(
      'never throws out of createHousehold — errors land in state',
      () async {
        final ProviderContainer container = _container(
          FakeHouseholdRepository(error: const ForbiddenError('nope')),
        );
        await container.read(createHouseholdControllerProvider.future);

        // Deliberately not wrapped in expectLater/throwsA: the contract is that
        // this call completes normally, matching `AuthController`.
        await container
            .read(createHouseholdControllerProvider.notifier)
            .createHousehold('Kulkarni Kitchen');

        expect(
          container.read(createHouseholdControllerProvider).hasError,
          isTrue,
        );
      },
    );

    group('surfaces each AppError subtype distinctly', () {
      final List<AppError> failures = <AppError>[
        const UnauthorizedError('signed out'),
        const ForbiddenError('not a member'),
        const ValidationError('name must not be empty'),
        const ConflictError('already exists'),
        const NotFoundError('gone'),
        const HouseholdFullError('five already'),
        const RateLimitedError('slow down'),
        const InternalError('boom'),
      ];

      for (final AppError failure in failures) {
        test(
          '${failure.errorType} is not collapsed to a generic error',
          () async {
            final ProviderContainer container = _container(
              FakeHouseholdRepository(error: failure),
            );
            await container.read(createHouseholdControllerProvider.future);

            await container
                .read(createHouseholdControllerProvider.notifier)
                .createHousehold('Kulkarni Kitchen');

            final Object? error = container
                .read(createHouseholdControllerProvider)
                .error;
            expect(error.runtimeType, failure.runtimeType);
            expect((error! as AppError).errorMessage, failure.errorMessage);
          },
        );
      }
    });

    test('a second attempt after a failure clears the error', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        error: const InternalError('cold start timed out'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(createHouseholdControllerProvider.future);
      final CreateHouseholdController controller = container.read(
        createHouseholdControllerProvider.notifier,
      );

      await controller.createHousehold('Kulkarni Kitchen');
      expect(
        container.read(createHouseholdControllerProvider).hasError,
        isTrue,
      );

      repository
        ..error = null
        ..result = testHousehold;
      await controller.createHousehold('Kulkarni Kitchen');

      final AsyncValue<Household?> state = container.read(
        createHouseholdControllerProvider,
      );
      expect(state.hasError, isFalse);
      expect(state.value, testHousehold);
    });

    group('timeout / transient failures (A2)', () {
      ProviderContainer retryContainer(FakeHouseholdRepository repository) {
        final ProviderContainer container = ProviderContainer(
          overrides: <Override>[
            householdRepositoryProvider.overrideWithValue(repository),
            createHouseholdRetryDelayProvider.overrideWithValue(Duration.zero),
          ],
        );
        addTearDown(container.dispose);
        return container;
      }

      test('retries once after a transient failure and succeeds', () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          result: testHousehold,
        )..createErrorQueue.add(const InternalError('timeout'));
        final ProviderContainer container = retryContainer(repository);

        await container
            .read(createHouseholdControllerProvider.notifier)
            .createHousehold('Kulkarni Kitchen');

        expect(repository.calls, <String>['Kulkarni Kitchen', 'Kulkarni Kitchen']);
        expect(
          container.read(createHouseholdControllerProvider).value,
          testHousehold,
        );
      });

      test('gives up after one retry and parks the error', () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          error: const InternalError('timeout'),
        );
        final ProviderContainer container = retryContainer(repository);

        await container
            .read(createHouseholdControllerProvider.notifier)
            .createHousehold('Kulkarni Kitchen');

        expect(repository.calls, hasLength(2));
        expect(
          container.read(createHouseholdControllerProvider).error,
          isA<InternalError>(),
        );
      });

      test('does not retry a real (non-transient) error', () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          error: const ValidationError('name must not be empty'),
        );
        final ProviderContainer container = retryContainer(repository);

        await container
            .read(createHouseholdControllerProvider.notifier)
            .createHousehold('x');

        expect(repository.calls, hasLength(1));
      });

      test('reset clears a parked error back to idle', () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          error: const ValidationError('bad'),
        );
        final ProviderContainer container = retryContainer(repository);
        final CreateHouseholdController notifier = container.read(
          createHouseholdControllerProvider.notifier,
        );
        await notifier.createHousehold('x');
        expect(container.read(createHouseholdControllerProvider).hasError, isTrue);

        notifier.reset();

        final AsyncValue<Household?> state = container.read(
          createHouseholdControllerProvider,
        );
        expect(state.hasError, isFalse);
        expect(state.value, isNull);
      });
    });
  });
}
