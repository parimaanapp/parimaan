import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/presentation/splash_screen.dart';
import 'package:mobile/shared/ui/colors.dart';
import 'package:mobile/shared/ui/typography.dart';
import 'package:mocktail/mocktail.dart';

import '../../../support/fake_auth_repository.dart';

void main() {
  group('SplashScreen', () {
    testWidgets('renders the Devanagari wordmark while auth is loading', (
      WidgetTester tester,
    ) async {
      final Completer<AuthSession> pending = Completer<AuthSession>();
      final MockAuthRepository repository = stubbedAuthRepository();
      when(repository.currentSession).thenAnswer((_) => pending.future);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(repository),
          ],
          child: const MaterialApp(home: SplashScreen()),
        ),
      );
      await tester.pump();

      final Finder wordmark = find.text(SplashScreen.wordmark);
      expect(wordmark, findsOneWidget);
      expect(
        tester.widget<Text>(wordmark).style?.fontFamily,
        AppFontFamily.wordmark,
      );

      pending.complete(const AuthSession.signedOut());
      await tester.pumpAndSettle();
    });

    testWidgets('renders the Parimaan mark above the wordmark', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
          ],
          child: const MaterialApp(home: SplashScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(SplashScreen.markKey), findsOneWidget);
      final Offset markCenter = tester.getCenter(
        find.byKey(SplashScreen.markKey),
      );
      final Offset wordmarkCenter = tester.getCenter(
        find.text(SplashScreen.wordmark),
      );
      expect(markCenter.dy, lessThan(wordmarkCenter.dy));
    });

    testWidgets('sits on the paper background', (WidgetTester tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
          ],
          child: const MaterialApp(home: SplashScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        AppColors.paper,
      );
      // The screen never navigates by itself — the router redirect owns that.
      expect(find.text(SplashScreen.wordmark), findsOneWidget);
    });
  });
}
