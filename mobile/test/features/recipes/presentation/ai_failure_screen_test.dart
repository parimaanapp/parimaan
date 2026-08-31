import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/presentation/ai_failure_screen.dart';
import 'package:mobile/features/recipes/presentation/freeform_input_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_form_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

const String _url = 'https://example.com/unreadable-page';
const String _message =
    "Couldn't read that page. Try pasting the recipe text instead.";

Future<void> _pumpPushed(WidgetTester tester) async {
  final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: ElevatedButton(
                onPressed: () => context.push('/ai-failure'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/ai-failure',
        builder: (BuildContext context, GoRouterState state) =>
            const AiFailureScreen(
              householdId: 'household-1',
              errorMessage: _message,
              preservedInput: _url,
            ),
      ),
      GoRoute(
        path: '/home/recipes/new',
        builder: (BuildContext context, GoRouterState state) =>
            const RecipeFormScreen(householdId: 'household-1'),
      ),
      GoRoute(
        path: '/home/recipes/new/freeform',
        builder: (BuildContext context, GoRouterState state) =>
            const FreeformInputScreen(householdId: 'household-1'),
      ),
    ],
  );

  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      recipeRepositoryProvider.overrideWithValue(FakeRecipeRepository()),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('AiFailureScreen', () {
    testWidgets('preserves and displays the input that failed, and the server message', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester);

      expect(find.text(_message), findsOneWidget);
      expect(find.byKey(AiFailureScreen.preservedInputKey), findsOneWidget);
      expect(find.text(_url), findsOneWidget);
    });

    testWidgets('"Enter details manually" opens a real (empty) RecipeFormScreen', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester);

      await tester.tap(find.byKey(AiFailureScreen.manualEntryButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(RecipeFormScreen), findsOneWidget);
      final RecipeFormScreen form = tester.widget<RecipeFormScreen>(
        find.byType(RecipeFormScreen),
      );
      expect(form.initialRecipe, isNull);
      expect(form.initialDraft, isNull);
    });

    testWidgets('"Paste the text instead" opens FreeformInputScreen', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester);

      await tester.tap(find.byKey(AiFailureScreen.pasteInsteadButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(FreeformInputScreen), findsOneWidget);
    });

    testWidgets('the top-bar back button pops', (WidgetTester tester) async {
      await _pumpPushed(tester);

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(find.byType(AiFailureScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });
  });
}
