import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/onboarding/presentation/first_run_choose_path_screen.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_auth_repository.dart';
import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// Boots the real app router signed in, which the redirect guard settles on
/// [AppRoutes.firstRun]. Going through the router (rather than pumping the
/// screen bare) is what lets the navigation assertions be real.
Future<({GoRouter router, FakeHouseholdRepository repository})> _pumpScreen(
  WidgetTester tester, {
  FakeHouseholdRepository? repository,
}) async {
  final FakeHouseholdRepository repo =
      repository ?? FakeHouseholdRepository(result: testHousehold);

  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(
        stubbedAuthRepository(session: testSignedInSession),
      ),
      householdRepositoryProvider.overrideWithValue(repo),
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
  return (router: router, repository: repo);
}

void main() {
  group('FirstRunChoosePathScreen — the two paths', () {
    testWidgets('renders both paths and nothing else', (
      WidgetTester tester,
    ) async {
      await _pumpScreen(tester);

      expect(find.byKey(FirstRunChoosePathScreen.createButtonKey), findsOne);
      expect(find.byKey(FirstRunChoosePathScreen.joinButtonKey), findsOne);
    });

    testWidgets(
      'no longer asks for a household name — that moved to wizard step 2.1',
      (WidgetTester tester) async {
        await _pumpScreen(tester);

        expect(find.byType(TextField), findsNothing);
      },
    );

    testWidgets(
      'the create path navigates into the wizard instead of creating a '
      'household here',
      (WidgetTester tester) async {
        final subject = await _pumpScreen(tester);

        await tester.tap(find.byKey(FirstRunChoosePathScreen.createButtonKey));
        await tester.pumpAndSettle();

        expect(_location(subject.router), AppRoutes.createHouseholdName);
        // The whole point of the reconciliation: this screen must not be a
        // second, independent way to create a household.
        expect(subject.repository.calls, isEmpty);
      },
    );

    testWidgets('the join path navigates to the join route', (
      WidgetTester tester,
    ) async {
      final subject = await _pumpScreen(tester);

      await tester.tap(find.byKey(FirstRunChoosePathScreen.joinButtonKey));
      await tester.pumpAndSettle();

      expect(_location(subject.router), AppRoutes.joinHousehold);
    });

    testWidgets('the join route is an explicit not-built-yet state', (
      WidgetTester tester,
    ) async {
      final subject = await _pumpScreen(tester);

      subject.router.go(AppRoutes.joinHousehold);
      await tester.pumpAndSettle();

      expect(find.byKey(JoinHouseholdComingSoonScreen.bodyKey), findsOne);
    });

    testWidgets('the join placeholder can get back to the chooser', (
      WidgetTester tester,
    ) async {
      final subject = await _pumpScreen(tester);
      subject.router.go(AppRoutes.joinHousehold);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Go back'));
      await tester.pumpAndSettle();

      expect(_location(subject.router), AppRoutes.firstRun);
    });
  });
}
