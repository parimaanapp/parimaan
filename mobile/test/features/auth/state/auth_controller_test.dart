import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_failure.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mocktail/mocktail.dart';

import '../../../support/fake_auth_repository.dart';

ProviderContainer _containerWith(MockAuthRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[authRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
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
