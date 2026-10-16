import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/active_household_selection_controller.dart';
import 'package:mobile/features/household/state/active_household_store.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/features/household/state/join_household_controller.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/shared/storage/app_database.dart';
import 'package:drift/native.dart';
import 'package:mocktail/mocktail.dart';

import '../../../support/fake_active_household_store.dart';
import '../../../support/fake_auth_repository.dart';
import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

Household _household(String id, String name) => Household(
  id: id,
  name: name,
  inviteCode: 'CODE-$id',
  primaryUserId: 'user-1',
  subscriptionStatus: SubscriptionStatus.free,
  settings: testHousehold.settings,
  members: const <HouseholdMembership>[],
);

final Household _oldest = _household('h-old', 'S9 Sync Test');
final Household _real = _household('h-real', 'Kulkarni Kitchen');
final Household _third = _household('h-third', 'Third');

class _Setup {
  _Setup(this.container, this.store, this.sessions);
  final ProviderContainer container;
  final InMemoryActiveHouseholdStore store;
  final StreamController<AuthSession> sessions;
}

Future<_Setup> _setup({
  InMemoryActiveHouseholdStore? store,
  List<Household>? households,
  AuthSession session = testSignedInSession,
}) async {
  final InMemoryActiveHouseholdStore s =
      store ?? InMemoryActiveHouseholdStore();
  final StreamController<AuthSession> sessions =
      StreamController<AuthSession>.broadcast();
  addTearDown(sessions.close);
  final MockAuthRepository auth = stubbedAuthRepository(session: session);
  when(auth.sessionChanges).thenAnswer((_) => sessions.stream);

  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(auth),
      appDatabaseProvider.overrideWithValue(db),
      activeHouseholdStoreProvider.overrideWithValue(s),
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(
          myHouseholdsResult: households ?? <Household>[_oldest, _real, _third],
          joinResult: testHouseholdWithMembers,
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  await container.read(authControllerProvider.future);
  await container.read(meHouseholdsControllerProvider.future);
  await container.read(activeHouseholdSelectionControllerProvider.future);
  return _Setup(container, s, sessions);
}

void main() {
  group('activeHouseholdProvider with a household choice', () {
    test(
      'defaults to the first (oldest) household when nothing is chosen',
      () async {
        final _Setup t = await _setup();

        expect(t.container.read(activeHouseholdProvider)?.id, 'h-old');
      },
    );

    test(
      'select() makes the chosen household active and persists it',
      () async {
        final _Setup t = await _setup();

        final bool ok = await t.container
            .read(activeHouseholdSelectionControllerProvider.notifier)
            .select('h-real');

        expect(ok, isTrue);
        expect(t.container.read(activeHouseholdProvider)?.id, 'h-real');
        expect(t.store.slot, (userId: 'user-1', householdId: 'h-real'));
      },
    );

    test('select() refuses an id that is not in the server list', () async {
      final _Setup t = await _setup();

      final bool ok = await t.container
          .read(activeHouseholdSelectionControllerProvider.notifier)
          .select('not-mine');

      expect(ok, isFalse);
      expect(t.container.read(activeHouseholdProvider)?.id, 'h-old');
      expect(t.store.slot.householdId, isNull);
    });

    test('a stored choice is restored on the next launch', () async {
      final _Setup t = await _setup(
        store: InMemoryActiveHouseholdStore(
          userId: 'user-1',
          householdId: 'h-real',
        ),
      );

      expect(t.container.read(activeHouseholdProvider)?.id, 'h-real');
    });

    test('a stored id missing from the server list is ignored', () async {
      final _Setup t = await _setup(
        store: InMemoryActiveHouseholdStore(
          userId: 'user-1',
          householdId: 'left-this-one',
        ),
      );

      expect(t.container.read(activeHouseholdProvider)?.id, 'h-old');
    });

    test("another user's stored choice is never honoured", () async {
      final _Setup t = await _setup(
        store: InMemoryActiveHouseholdStore(
          userId: 'someone-else',
          householdId: 'h-real',
        ),
      );

      expect(t.container.read(activeHouseholdProvider)?.id, 'h-old');
    });

    test('switching invalidates session-scoped household state', () async {
      final _Setup t = await _setup();
      await t.container.read(joinHouseholdControllerProvider.future);
      await t.container
          .read(joinHouseholdControllerProvider.notifier)
          .join('K4M9PQ');
      expect(
        t.container.read(joinHouseholdControllerProvider).valueOrNull,
        isNotNull,
      );

      await t.container
          .read(activeHouseholdSelectionControllerProvider.notifier)
          .select('h-third');
      await t.container.read(joinHouseholdControllerProvider.future);

      expect(
        t.container.read(joinHouseholdControllerProvider).valueOrNull,
        isNull,
      );
      expect(t.container.read(activeHouseholdProvider)?.id, 'h-third');
    });

    test('signing out clears the persisted choice', () async {
      final _Setup t = await _setup();
      await t.container
          .read(activeHouseholdSelectionControllerProvider.notifier)
          .select('h-real');

      await t.container.read(authControllerProvider.notifier).signOut();

      expect(t.store.clearCount, 1);
      expect(t.store.slot.householdId, isNull);
    });

    test("a different signed-in user does not inherit the previous user's "
        'choice', () async {
      final _Setup t = await _setup();
      await t.container
          .read(activeHouseholdSelectionControllerProvider.notifier)
          .select('h-real');
      expect(t.container.read(activeHouseholdProvider)?.id, 'h-real');

      t.sessions.add(
        const AuthSession.signedIn(userId: 'user-B', email: 'b@example.com'),
      );
      await Future<void>.delayed(Duration.zero);
      await t.container.read(meHouseholdsControllerProvider.future);
      await t.container.read(activeHouseholdSelectionControllerProvider.future);

      expect(t.container.read(activeHouseholdProvider)?.id, 'h-old');
    });
  });
}
