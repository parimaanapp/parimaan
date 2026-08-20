import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/onboarding/presentation/first_run_choose_path_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_auth_repository.dart';
import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// Boots the real app router signed in, which the redirect guard settles on
/// [AppRoutes.firstRun]. Going through the router (rather than pumping the
/// screen bare) is what lets the navigation assertions be real.
Future<GoRouter> _pumpScreen(
  WidgetTester tester,
  FakeHouseholdRepository repository,
) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(
        stubbedAuthRepository(session: testSignedInSession),
      ),
      householdRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);

  await container.read(authControllerProvider.future);
  final GoRouter router = container.read(goRouterProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router, theme: parimaanTheme()),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

Future<void> _enterName(WidgetTester tester, String name) async {
  await tester.enterText(
    find.byKey(FirstRunChoosePathScreen.nameFieldKey),
    name,
  );
  await tester.pump();
}

Future<void> _tapCreate(WidgetTester tester) async {
  await tester.tap(find.byKey(FirstRunChoosePathScreen.createButtonKey));
}

void main() {
  group('FirstRunChoosePathScreen — the two paths', () {
    testWidgets('renders both paths', (WidgetTester tester) async {
      await _pumpScreen(tester, FakeHouseholdRepository(result: testHousehold));

      expect(find.byKey(FirstRunChoosePathScreen.createButtonKey), findsOne);
      expect(find.byKey(FirstRunChoosePathScreen.joinButtonKey), findsOne);
      expect(find.byKey(FirstRunChoosePathScreen.nameFieldKey), findsOne);
    });

    testWidgets('the join path navigates to the join route', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpScreen(
        tester,
        FakeHouseholdRepository(result: testHousehold),
      );

      await tester.tap(find.byKey(FirstRunChoosePathScreen.joinButtonKey));
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.joinHousehold);
    });

    testWidgets('the join route is an explicit not-built-yet state', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpScreen(
        tester,
        FakeHouseholdRepository(result: testHousehold),
      );

      router.go(AppRoutes.joinHousehold);
      await tester.pumpAndSettle();

      expect(find.byKey(JoinHouseholdComingSoonScreen.bodyKey), findsOne);
    });
  });

  group('FirstRunChoosePathScreen — creating', () {
    testWidgets('a valid name dispatches to the controller', (
      WidgetTester tester,
    ) async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
      );
      await _pumpScreen(tester, repository);

      await _enterName(tester, 'Kulkarni Kitchen');
      await _tapCreate(tester);
      await tester.pumpAndSettle();

      expect(repository.calls, <String>['Kulkarni Kitchen']);
    });

    testWidgets('navigates onward on success', (WidgetTester tester) async {
      final GoRouter router = await _pumpScreen(
        tester,
        FakeHouseholdRepository(result: testHousehold),
      );

      await _enterName(tester, 'Kulkarni Kitchen');
      await _tapCreate(tester);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.home);
    });
  });

  group('FirstRunChoosePathScreen — validation', () {
    testWidgets('an empty name renders an inline error and calls nothing', (
      WidgetTester tester,
    ) async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
      );
      await _pumpScreen(tester, repository);

      await _tapCreate(tester);
      await tester.pump();

      expect(find.text('name must not be empty'), findsOne);
      expect(repository.calls, isEmpty);
    });

    testWidgets('an over-long name renders an inline error', (
      WidgetTester tester,
    ) async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
      );
      await _pumpScreen(tester, repository);

      await _enterName(tester, 'a' * 61);
      await _tapCreate(tester);
      await tester.pump();

      expect(find.text('name must be at most 60 characters'), findsOne);
      expect(repository.calls, isEmpty);
    });

    testWidgets('the inline error clears once the name is corrected', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, FakeHouseholdRepository(result: testHousehold));

      await _tapCreate(tester);
      await tester.pump();
      expect(find.text('name must not be empty'), findsOne);

      await _enterName(tester, 'Kulkarni Kitchen');
      expect(find.text('name must not be empty'), findsNothing);
    });
  });

  group('FirstRunChoosePathScreen — the Aurora cold start', () {
    testWidgets('the loading state is legible, not a frozen button', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(
        tester,
        FakeHouseholdRepository(
          result: testHousehold,
          // Well past the ~30s worst case documented in RUNBOOK.md, so the
          // assertions below describe a genuinely long wait.
          delay: const Duration(seconds: 40),
        ),
      );

      await _enterName(tester, 'Kulkarni Kitchen');
      await _tapCreate(tester);
      await tester.pump();

      // `PButton`'s own loading affordance — spinner plus alternate copy.
      expect(find.text(FirstRunChoosePathScreen.createLoadingLabel), findsOne);
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      // And the honest explanation of why this is slow, so a 30s wait does not
      // read as a hang.
      expect(find.byKey(FirstRunChoosePathScreen.coldStartHintKey), findsOne);

      await tester.pump(const Duration(seconds: 40));
      await tester.pumpAndSettle();
    });

    testWidgets('the create button is inert while in flight', (
      WidgetTester tester,
    ) async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository(
        result: testHousehold,
        delay: const Duration(seconds: 40),
      );
      await _pumpScreen(tester, repository);

      await _enterName(tester, 'Kulkarni Kitchen');
      await _tapCreate(tester);
      await tester.pump();
      await _tapCreate(tester);
      await tester.pump();

      expect(repository.calls, hasLength(1));

      await tester.pump(const Duration(seconds: 40));
      await tester.pumpAndSettle();
    });
  });

  group('FirstRunChoosePathScreen — server errors', () {
    testWidgets('renders the server message and stays put', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpScreen(
        tester,
        FakeHouseholdRepository(
          error: const RateLimitedError('Too many attempts. Try tomorrow.'),
        ),
      );

      await _enterName(tester, 'Kulkarni Kitchen');
      await _tapCreate(tester);
      await tester.pumpAndSettle();

      expect(find.byKey(FirstRunChoosePathScreen.serverErrorKey), findsOne);
      expect(find.text('Too many attempts. Try tomorrow.'), findsOne);
      expect(_location(router), AppRoutes.firstRun);
    });

    testWidgets('no error line is rendered before anything is attempted', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester, FakeHouseholdRepository(result: testHousehold));

      expect(find.byKey(FirstRunChoosePathScreen.serverErrorKey), findsNothing);
    });
  });
}
