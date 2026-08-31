import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_failure.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/shared/storage/app_database.dart';
import 'package:mocktail/mocktail.dart';

import '../../../support/fake_auth_repository.dart';
import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

ProviderContainer _containerWith(MockAuthRepository repository) {
  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(repository),
      appDatabaseProvider.overrideWithValue(db),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(db.close);
  return container;
}

void main() {
  group('AuthController cold start', () {
    test('starts loading, then resolves to the signed-out session', () async {
      final MockAuthRepository repository = stubbedAuthRepository();
      final ProviderContainer container = _containerWith(repository);

      expect(
        container.read(authControllerProvider),
        const AsyncLoading<AuthSession>(),
      );

      await container.read(authControllerProvider.future);

      expect(
        container.read(authControllerProvider),
        const AsyncData<AuthSession>(AuthSession.signedOut()),
      );
      verify(repository.currentSession).called(1);
    });

    test('reflects a restored signed-in session', () async {
      final MockAuthRepository repository = stubbedAuthRepository(
        session: testSignedInSession,
      );
      final ProviderContainer container = _containerWith(repository);

      await container.read(authControllerProvider.future);

      expect(container.read(authControllerProvider).value, testSignedInSession);
    });
  });

  group('AuthController failure surfacing', () {
    Future<Object?> errorFor(AuthFailure failure) async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.currentSession).thenThrow(failure);
      final ProviderContainer container = _containerWith(repository);

      await expectLater(
        container.read(authControllerProvider.future),
        throwsA(isA<AuthFailure>()),
      );
      return container.read(authControllerProvider).error;
    }

    test('cancelled stays a distinct AuthCancelled', () async {
      expect(await errorFor(const AuthCancelled()), isA<AuthCancelled>());
    });

    test('network stays a distinct AuthNetworkFailure', () async {
      expect(
        await errorFor(const AuthNetworkFailure()),
        isA<AuthNetworkFailure>(),
      );
    });

    test('configuration stays a distinct AuthConfigurationFailure', () async {
      final Object? error = await errorFor(
        const AuthConfigurationFailure(message: 'placeholder config'),
      );

      expect(error, isA<AuthConfigurationFailure>());
      expect(
        (error! as AuthConfigurationFailure).message,
        'placeholder config',
      );
    });

    test('unknown stays a distinct AuthUnknownFailure', () async {
      expect(
        await errorFor(const AuthUnknownFailure()),
        isA<AuthUnknownFailure>(),
      );
    });

    test('the four variants are not collapsed into one error type', () async {
      final Set<Type> types = <Type>{
        (await errorFor(const AuthCancelled())).runtimeType,
        (await errorFor(const AuthNetworkFailure())).runtimeType,
        (await errorFor(const AuthConfigurationFailure(message: 'x')))
            .runtimeType,
        (await errorFor(const AuthUnknownFailure())).runtimeType,
      };

      expect(types, hasLength(4));
    });
  });

  group('AuthController.signInWithGoogle', () {
    test('moves to the signed-in session on success', () async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle)
          .thenAnswer((_) async => testSignedInSession);
      final ProviderContainer container = _containerWith(repository);
      await container.read(authControllerProvider.future);

      await container.read(authControllerProvider.notifier).signInWithGoogle();

      expect(container.read(authControllerProvider).value, testSignedInSession);
    });

    test('surfaces the failure without throwing out of the method', () async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle).thenThrow(const AuthNetworkFailure());
      final ProviderContainer container = _containerWith(repository);
      await container.read(authControllerProvider.future);

      await container.read(authControllerProvider.notifier).signInWithGoogle();

      expect(
        container.read(authControllerProvider).error,
        isA<AuthNetworkFailure>(),
      );
    });
  });

  group('AuthController.signOut', () {
    test('returns to the signed-out session', () async {
      final MockAuthRepository repository = stubbedAuthRepository(
        session: testSignedInSession,
      );
      final ProviderContainer container = _containerWith(repository);
      await container.read(authControllerProvider.future);

      await container.read(authControllerProvider.notifier).signOut();

      expect(
        container.read(authControllerProvider).value,
        const AuthSession.signedOut(),
      );
      verify(repository.signOut).called(1);
    });

    test('evicts the entire pantry read cache — a shared-phone privacy leak otherwise', () async {
      final MockAuthRepository repository = stubbedAuthRepository(
        session: testSignedInSession,
      );
      final AppDatabase db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      await db.pantryDao.replaceAll('household-1', <PantryItem>[
        PantryItem(
          id: 'item-1',
          householdId: 'household-1',
          name: 'Toor Dal',
          quantity: 2,
          unit: 'kg',
          isStaple: false,
          addedBy: 'user-1',
          addedAt: DateTime.utc(2026, 8, 25),
          updatedAt: DateTime.utc(2026, 8, 25),
        ),
      ]);
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(repository),
          appDatabaseProvider.overrideWithValue(db),
        ],
      );
      addTearDown(container.dispose);
      await container.read(authControllerProvider.future);

      await container.read(authControllerProvider.notifier).signOut();

      expect(await db.pantryDao.readPantryItems('household-1'), isEmpty);
    });

    test(
      'invalidates the cached household list, so the next sign-in fetches '
      'fresh — a shared-phone privacy leak otherwise (W8 S1)',
      () async {
        final MockAuthRepository repository = stubbedAuthRepository(
          session: testSignedInSession,
        );
        final FakeHouseholdRepository households = FakeHouseholdRepository(
          myHouseholdsResult: <Household>[testHousehold],
        );
        final ProviderContainer container = ProviderContainer(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(repository),
            appDatabaseProvider.overrideWithValue(
              AppDatabase(NativeDatabase.memory()),
            ),
            householdRepositoryProvider.overrideWithValue(households),
          ],
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);

        // Populate the cache, as the router's redirect guard would on this
        // user's session — this is the exact stale value a second user on a
        // shared device must not inherit after a sign-out.
        await container.read(meHouseholdsControllerProvider.future);
        expect(households.myHouseholdsCallCount, 1);

        await container.read(authControllerProvider.notifier).signOut();

        // Invalidated, not merely re-read with the same answer: the next
        // read must trigger a genuinely fresh fetch (a second call to the
        // repository), not silently return the first user's cached list.
        await container.read(meHouseholdsControllerProvider.future);
        expect(households.myHouseholdsCallCount, 2);
      },
    );

    test(
      'still transitions to signed-out even if the pantry cache eviction fails',
      () async {
        final MockAuthRepository repository = stubbedAuthRepository(
          session: testSignedInSession,
        );
        final AppDatabase db = AppDatabase(NativeDatabase.memory());
        addTearDown(db.close);
        // Breaks `clearAll()` (a DELETE against a table that no longer
        // exists) without needing a fakeable DAO seam — the closest this
        // harness can get to a real on-device storage failure.
        await db.customStatement('DROP TABLE pantry_items_table');

        final ProviderContainer container = ProviderContainer(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(repository),
            appDatabaseProvider.overrideWithValue(db),
          ],
        );
        addTearDown(container.dispose);
        await container.read(authControllerProvider.future);

        await container.read(authControllerProvider.notifier).signOut();

        // A broken local cache must never masquerade as a failed account
        // sign-out — Cognito sign-out already succeeded (the fake
        // repository never fails), so the router-facing state must reflect
        // that, not get stranded on the previous signed-in session.
        expect(
          container.read(authControllerProvider).value,
          const AuthSession.signedOut(),
        );
      },
    );
  });

  group('AuthController session stream', () {
    test('adopts sessions pushed by the repository', () async {
      final StreamController<AuthSession> changes =
          StreamController<AuthSession>.broadcast();
      addTearDown(changes.close);
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.sessionChanges).thenAnswer((_) => changes.stream);
      final ProviderContainer container = _containerWith(repository);
      await container.read(authControllerProvider.future);

      changes.add(testSignedInSession);
      await Future<void>.delayed(Duration.zero);

      expect(container.read(authControllerProvider).value, testSignedInSession);
    });
  });
}
