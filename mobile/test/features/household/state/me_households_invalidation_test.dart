import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/create_household_controller.dart';
import 'package:mobile/features/household/state/household_settings_controller.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/features/household/state/join_household_controller.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

/// A9: the cached `Query.me` list must be refetched after every membership
/// mutation, otherwise the active household can be stale or wrong.
void main() {
  late FakeHouseholdRepository repository;
  late ProviderContainer container;

  Future<void> setUpWith(FakeHouseholdRepository repo) async {
    repository = repo;
    container = ProviderContainer(
      overrides: <Override>[
        householdRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
    await container.read(meHouseholdsControllerProvider.future);
    expect(repository.myHouseholdsCallCount, 1);
  }

  FakeHouseholdRepository happyRepo() => FakeHouseholdRepository(
    result: testHousehold,
    joinResult: testHouseholdWithMembers,
    myHouseholdsResult: <Household>[testHousehold],
  );

  Future<void> expectRefetched() async {
    await container.read(meHouseholdsControllerProvider.future);
    expect(repository.myHouseholdsCallCount, 2);
  }

  test('create refetches the list', () async {
    await setUpWith(happyRepo());
    await container
        .read(createHouseholdControllerProvider.notifier)
        .createHousehold('Kulkarni Kitchen');
    await expectRefetched();
  });

  test('join refetches the list', () async {
    await setUpWith(happyRepo());
    await container
        .read(joinHouseholdControllerProvider.notifier)
        .join('K4M9PQ');
    await expectRefetched();
  });

  test('wizard adoptHousehold refetches the list', () async {
    await setUpWith(happyRepo());
    await container.read(householdWizardControllerProvider.future);
    container
        .read(householdWizardControllerProvider.notifier)
        .adoptHousehold(testHousehold);
    await expectRefetched();
  });

  test('leave refetches the list', () async {
    await setUpWith(happyRepo());
    await container
        .read(householdSettingsControllerProvider.notifier)
        .leaveHousehold('household-1');
    await expectRefetched();
  });

  test('delete refetches the list', () async {
    await setUpWith(happyRepo());
    await container
        .read(householdSettingsControllerProvider.notifier)
        .deleteHousehold('household-1', 'Kulkarni Kitchen');
    await expectRefetched();
  });

  test('a failed leave does not refetch', () async {
    await setUpWith(
      FakeHouseholdRepository(
        myHouseholdsResult: <Household>[testHousehold],
        leaveError: Exception('boom'),
      ),
    );
    await container
        .read(householdSettingsControllerProvider.notifier)
        .leaveHousehold('household-1');
    await container.read(meHouseholdsControllerProvider.future);
    expect(repository.myHouseholdsCallCount, 1);
  });
}
