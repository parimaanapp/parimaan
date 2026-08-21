import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/features/household/state/household_settings_controller.dart';
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

/// The same household carrying a rotated code, for the push-don't-refetch test.
final Household _rotated = Household(
  id: testHousehold.id,
  name: testHousehold.name,
  inviteCode: 'ZY9WX8',
  primaryUserId: testHousehold.primaryUserId,
  subscriptionStatus: testHousehold.subscriptionStatus,
  settings: testHousehold.settings,
  members: testHousehold.members,
);

void main() {
  group('HouseholdSettingsController — rotateInviteCode', () {
    test('rotates and reports success', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        rotateResult: _rotated,
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);

      final bool ok = await container
          .read(householdSettingsControllerProvider.notifier)
          .rotateInviteCode('household-1');

      expect(ok, isTrue);
      expect(repository.rotateCalls, <String>['household-1']);
    });

    test('pushes the returned household into the current-household provider '
        'rather than triggering a second round trip', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        fetchResult: testHousehold,
        rotateResult: _rotated,
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentHouseholdControllerProvider('household-1').future,
      );
      await container.read(householdSettingsControllerProvider.future);

      await container
          .read(householdSettingsControllerProvider.notifier)
          .rotateInviteCode('household-1');

      expect(
        container
            .read(currentHouseholdControllerProvider('household-1'))
            .valueOrNull!
            .inviteCode,
        'ZY9WX8',
      );
      expect(
        repository.fetchCalls,
        hasLength(1),
        reason: 'the mutation already returned the whole household',
      );
    });

    test('a RATE_LIMITED rotate keeps its message for the screen', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        rotateError: const RateLimitedError('Too many rotations today.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);

      final bool ok = await container
          .read(householdSettingsControllerProvider.notifier)
          .rotateInviteCode('household-1');

      expect(ok, isFalse);
      expect(
        container.read(householdSettingsControllerProvider).error,
        isA<RateLimitedError>(),
      );
    });
  });

  group('HouseholdSettingsController — leaveHousehold', () {
    test('leaves and reports success', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);

      final bool ok = await container
          .read(householdSettingsControllerProvider.notifier)
          .leaveHousehold('household-1');

      expect(ok, isTrue);
      expect(repository.leaveCalls, <String>['household-1']);
    });

    test('the primary is refused, and the server message survives', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        leaveError: const ForbiddenError(
          'The primary member cannot leave a household.',
        ),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);

      final bool ok = await container
          .read(householdSettingsControllerProvider.notifier)
          .leaveHousehold('household-1');

      expect(ok, isFalse);
      expect(
        container.read(householdSettingsControllerProvider).error,
        isA<ForbiddenError>().having(
          (ForbiddenError e) => e.errorMessage,
          'errorMessage',
          contains('primary member cannot leave'),
        ),
      );
    });
  });

  group('HouseholdSettingsController — deleteHousehold', () {
    test('forwards the confirmation name byte-for-byte', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);

      await container
          .read(householdSettingsControllerProvider.notifier)
          .deleteHousehold('household-1', '  Kulkarni Kitchen  ');

      // Nothing between the text field and the wire may normalize this.
      expect(
        repository.deleteCalls.single.confirmationName,
        '  Kulkarni Kitchen  ',
      );
    });

    test(
      'a mismatched name is a VALIDATION failure that deletes nothing',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          deleteError: const ValidationError(
            'confirmationName must exactly match the household name.',
          ),
        );
        final ProviderContainer container = _container(repository);
        await container.read(householdSettingsControllerProvider.future);

        final bool ok = await container
            .read(householdSettingsControllerProvider.notifier)
            .deleteHousehold('household-1', 'kulkarni kitchen');

        expect(ok, isFalse);
        expect(
          container.read(householdSettingsControllerProvider).error,
          isA<ValidationError>(),
        );
      },
    );

    test('a non-primary caller is refused', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        deleteError: const ForbiddenError(
          'Only the primary member can delete a household.',
        ),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);

      expect(
        await container
            .read(householdSettingsControllerProvider.notifier)
            .deleteHousehold('household-1', 'Kulkarni Kitchen'),
        isFalse,
      );
    });
  });

  group('HouseholdSettingsController — one action at a time', () {
    test('reports which action is in flight, so one row spins', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        rotateResult: _rotated,
        delay: const Duration(milliseconds: 20),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);
      final HouseholdSettingsController controller = container.read(
        householdSettingsControllerProvider.notifier,
      );

      expect(controller.action, HouseholdSettingsAction.none);

      final Future<bool> pending = controller.rotateInviteCode('household-1');
      expect(controller.action, HouseholdSettingsAction.rotateInviteCode);
      expect(
        container.read(householdSettingsControllerProvider).isLoading,
        isTrue,
      );

      await pending;
      expect(
        container.read(householdSettingsControllerProvider).isLoading,
        isFalse,
      );
    });

    test('a later action replaces the earlier one in `action`', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);
      final HouseholdSettingsController controller = container.read(
        householdSettingsControllerProvider.notifier,
      );

      await controller.leaveHousehold('household-1');
      expect(controller.action, HouseholdSettingsAction.leave);

      await controller.deleteHousehold('household-1', 'Kulkarni Kitchen');
      expect(controller.action, HouseholdSettingsAction.delete);
    });

    test('a retry after a failure clears the stale error', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        leaveError: const InternalError('network down'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);
      final HouseholdSettingsController controller = container.read(
        householdSettingsControllerProvider.notifier,
      );

      await controller.leaveHousehold('household-1');
      expect(
        container.read(householdSettingsControllerProvider).hasError,
        isTrue,
      );

      repository.leaveError = null;
      await controller.leaveHousehold('household-1');

      expect(
        container.read(householdSettingsControllerProvider).hasError,
        isFalse,
      );
    });

    test('no method ever throws', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        rotateError: const InternalError('boom'),
        leaveError: const InternalError('boom'),
        deleteError: const InternalError('boom'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(householdSettingsControllerProvider.future);
      final HouseholdSettingsController controller = container.read(
        householdSettingsControllerProvider.notifier,
      );

      await expectLater(
        controller.rotateInviteCode('household-1'),
        completion(isFalse),
      );
      await expectLater(
        controller.leaveHousehold('household-1'),
        completion(isFalse),
      );
      await expectLater(
        controller.deleteHousehold('household-1', 'Kulkarni Kitchen'),
        completion(isFalse),
      );
    });
  });
}
