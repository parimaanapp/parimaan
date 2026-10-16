import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/create_household_controller.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

/// Regression for the post-create spinner: me-households is read (empty)
/// BEFORE the household exists, create -> wizard adopt -> finish, and the
/// active household must resolve without an app restart.
void main() {
  test('create -> wizard adopt resolves the active household', () async {
    final FakeHouseholdRepository repository = FakeHouseholdRepository(
      result: testHousehold,
      myHouseholdsResult: const <Household>[],
    );
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        householdRepositoryProvider.overrideWithValue(repository),
        createHouseholdRetryDelayProvider.overrideWithValue(Duration.zero),
      ],
    );
    addTearDown(container.dispose);
    container.listen(activeHouseholdProvider, (_, _) {});

    expect(
      await container.read(meHouseholdsControllerProvider.future),
      isEmpty,
    );
    expect(container.read(activeHouseholdProvider), isNull);

    // The server only returns the household once it exists.
    repository.myHouseholdsResult = <Household>[testHousehold];

    await container
        .read(createHouseholdControllerProvider.notifier)
        .createHousehold('Kulkarni Kitchen');
    await container.read(householdWizardControllerProvider.future);
    container
        .read(householdWizardControllerProvider.notifier)
        .adoptHousehold(testHousehold);

    expect(container.read(activeHouseholdProvider)?.id, testHousehold.id);

    await container.read(meHouseholdsControllerProvider.future);
    expect(container.read(activeHouseholdProvider)?.id, testHousehold.id);
    expect(repository.myHouseholdsCallCount, greaterThanOrEqualTo(2));
  });
}
