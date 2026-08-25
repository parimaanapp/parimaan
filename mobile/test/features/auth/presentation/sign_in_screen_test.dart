import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_failure.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/presentation/sign_in_screen.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/shared/ui/theme.dart';
import 'package:mocktail/mocktail.dart';

import '../../../support/fake_auth_repository.dart';

Future<ProviderContainer> _pumpSignIn(
  WidgetTester tester,
  MockAuthRepository repository,
) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[authRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  await container.read(authControllerProvider.future);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(theme: parimaanTheme(), home: const SignInScreen()),
    ),
  );
  await tester.pump();
  return container;
}

void main() {
  group('SignInScreen', () {
    testWidgets('renders a single Continue with Google action', (
      WidgetTester tester,
    ) async {
      await _pumpSignIn(tester, stubbedAuthRepository());

      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.byType(ElevatedButton), findsOneWidget);
    });

    testWidgets('renders the Parimaan mark above the wordmark', (
      WidgetTester tester,
    ) async {
      await _pumpSignIn(tester, stubbedAuthRepository());

      expect(find.byKey(SignInScreen.markKey), findsOneWidget);
      final Offset markCenter = tester.getCenter(
        find.byKey(SignInScreen.markKey),
      );
      final Offset wordmarkCenter = tester.getCenter(find.text('परिमाण'));
      expect(markCenter.dy, lessThan(wordmarkCenter.dy));
    });

    testWidgets('tapping the button calls the repository sign-in', (
      WidgetTester tester,
    ) async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle)
          .thenAnswer((_) async => testSignedInSession);
      await _pumpSignIn(tester, repository);

      await tester.tap(find.text('Continue with Google'));
      await tester.pump();

      verify(repository.signInWithGoogle).called(1);
    });

    testWidgets('shows a loading state while sign-in is in flight', (
      WidgetTester tester,
    ) async {
      final Completer<AuthSession> pending = Completer<AuthSession>();
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle).thenAnswer((_) => pending.future);
      await _pumpSignIn(tester, repository);

      await tester.tap(find.text('Continue with Google'));
      await tester.pump();

      expect(find.text('Continue with Google'), findsNothing);
      expect(find.text('Signing in…'), findsOneWidget);
      expect(
        tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull,
      );

      pending.complete(const AuthSession.signedOut());
      await tester.pumpAndSettle();
    });

    testWidgets('network failure shows the connection copy', (
      WidgetTester tester,
    ) async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle).thenThrow(const AuthNetworkFailure());
      await _pumpSignIn(tester, repository);

      await tester.tap(find.text('Continue with Google'));
      await tester.pumpAndSettle();

      expect(
        find.text("Couldn't connect. Check your connection and try again."),
        findsOneWidget,
      );
    });

    testWidgets('cancelled failure shows no error at all', (
      WidgetTester tester,
    ) async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle).thenThrow(const AuthCancelled());
      await _pumpSignIn(tester, repository);

      await tester.tap(find.text('Continue with Google'));
      await tester.pumpAndSettle();

      expect(find.byKey(SignInScreen.errorKey), findsNothing);
      expect(find.text('Continue with Google'), findsOneWidget);
    });

    testWidgets('configuration failure shows generic copy, no internals', (
      WidgetTester tester,
    ) async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle).thenThrow(
        const AuthConfigurationFailure(message: 'REPLACE_ME_USER_POOL_ID'),
      );
      await _pumpSignIn(tester, repository);

      await tester.tap(find.text('Continue with Google'));
      await tester.pumpAndSettle();

      expect(
        find.text('Something went wrong. Please try again.'),
        findsOneWidget,
      );
      expect(find.textContaining('REPLACE_ME_USER_POOL_ID'), findsNothing);
    });

    testWidgets('unknown failure shows generic copy, no internals', (
      WidgetTester tester,
    ) async {
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.signInWithGoogle)
          .thenThrow(AuthUnknownFailure(cause: StateError('cognito exploded')));
      await _pumpSignIn(tester, repository);

      await tester.tap(find.text('Continue with Google'));
      await tester.pumpAndSettle();

      expect(
        find.text('Something went wrong. Please try again.'),
        findsOneWidget,
      );
      expect(find.textContaining('cognito exploded'), findsNothing);
    });
  });
}
