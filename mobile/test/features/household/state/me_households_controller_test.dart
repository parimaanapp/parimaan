import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
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
  group('MeHouseholdsController — build', () {
    test('fetches every household `Query.me` reports', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        myHouseholdsResult: <Household>[testHousehold, testHouseholdWithMembers],
      );
      final ProviderContainer container = _container(repository);

      final List<Household> households = await container.read(
        meHouseholdsControllerProvider.future,
      );

      expect(households, <Household>[testHousehold, testHouseholdWithMembers]);
      expect(repository.myHouseholdsCallCount, 1);
    });

    test('an empty list is a valid answer, not an error', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        myHouseholdsResult: const <Household>[],
      );
      final ProviderContainer container = _container(repository);

      final List<Household> households = await container.read(
        meHouseholdsControllerProvider.future,
      );

      expect(households, isEmpty);
    });

    test('a fetch failure lands in state with its concrete subtype', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        myHouseholdsError: const UnauthorizedError('no session'),
      );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(meHouseholdsControllerProvider.future),
        throwsA(isA<UnauthorizedError>()),
      );
      expect(
        container.read(meHouseholdsControllerProvider).error,
        isA<UnauthorizedError>(),
      );
    });
  });

  group('MeHouseholdsController — refresh', () {
    test('re-reads from the server', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        myHouseholdsResult: <Household>[testHousehold],
      );
      final ProviderContainer container = _container(repository);
      await container.read(meHouseholdsControllerProvider.future);

      await container.read(meHouseholdsControllerProvider.notifier).refresh();

      expect(repository.myHouseholdsCallCount, 2);
    });

    test('surfaces the newer list', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        myHouseholdsResult: <Household>[testHousehold],
      );
      final ProviderContainer container = _container(repository);
      await container.read(meHouseholdsControllerProvider.future);

      repository.myHouseholdsResult = <Household>[
        testHousehold,
        testHouseholdWithMembers,
      ];
      await container.read(meHouseholdsControllerProvider.notifier).refresh();

      expect(
        container.read(meHouseholdsControllerProvider).valueOrNull,
        hasLength(2),
      );
    });
  });
}
