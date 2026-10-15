import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/onboarding/presentation/welcome_choose_path_screen.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/household_fixtures.dart';

/// Real (minimal) `GoRouter` — same "the CTAs use `context.push`, which
/// needs a real `GoRouter` ancestor" reasoning `recipes_library_screen_test.dart`
/// already documents for its own FAB test. The two destinations are dummy
/// placeholder screens keyed by a plain `Text`, since this test only cares
/// about WHICH route each CTA lands on, not what that destination screen
/// itself renders (that is `AddMethodScreen`'s/`RecipeMethodScreen`'s own
/// coverage, exercised through `router_test.dart` instead).
Future<ProviderContainer> _pump(WidgetTester tester) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(myHouseholdsResult: <Household>[testHousehold]),
      ),
    ],
  );
  addTearDown(container.dispose);
  // Same "await the household source before pumping" step
  // `recipes_library_screen_test.dart`/`pantry_list_screen_test.dart` both
  // use — otherwise the screen's first build races `Query.me`.
  await container.read(meHouseholdsControllerProvider.future);

  final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) =>
            const WelcomeChoosePathScreen(),
      ),
      GoRoute(
        path: '/home/pantry/add',
        builder: (BuildContext context, GoRouterState state) =>
            const Text('pantry add method'),
      ),
      GoRoute(
        path: '/home/recipes/new/method',
        builder: (BuildContext context, GoRouterState state) =>
            const Text('recipe method'),
      ),
    ],
  );

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

void main() {
  group('WelcomeChoosePathScreen (W13 S6, D1)', () {
    testWidgets('renders the headline and question copy', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('Welcome!'), findsOneWidget);
      expect(find.text('What would you like to do first?'), findsOneWidget);
    });

    testWidgets(
      'renders no loading or error state of its own — structural, it '
      'performs no async work (D1)',
      (WidgetTester tester) async {
        await _pump(tester);

        expect(find.byType(CircularProgressIndicator), findsNothing);
        expect(find.byIcon(Icons.error_outline), findsNothing);
      },
    );

    testWidgets('"Add to Pantry" navigates to the pantry add-method chooser', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(WelcomeChoosePathScreen.pantryButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('pantry add method'), findsOneWidget);
    });

    testWidgets('"Add New Recipe" navigates to the recipe method chooser', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(WelcomeChoosePathScreen.recipeButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('recipe method'), findsOneWidget);
    });
  });
}
