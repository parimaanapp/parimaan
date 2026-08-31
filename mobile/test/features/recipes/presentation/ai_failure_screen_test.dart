import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/presentation/ai_failure_screen.dart';
import 'package:mobile/features/recipes/presentation/freeform_input_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_form_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

const String _url = 'https://example.com/unreadable-page';
const String _pastedText = 'Rajma Chawal: soak rajma overnight...';

Future<void> _pumpPushed(
  WidgetTester tester, {
  required AppError error,
  String preservedInput = _url,
  String inputLabel = 'URL',
}) async {
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
        builder: (BuildContext context, GoRouterState state) => AiFailureScreen(
          householdId: 'household-1',
          error: error,
          preservedInput: preservedInput,
          inputLabel: inputLabel,
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
    testWidgets(
      'preserves and displays the input that failed, and the server message',
      (WidgetTester tester) async {
        const message =
            "Couldn't read that page. Try pasting the recipe text instead.";
        await _pumpPushed(tester, error: const UrlUnreadableError(message));

        expect(find.text(message), findsOneWidget);
        expect(find.byKey(AiFailureScreen.preservedInputKey), findsOneWidget);
        expect(find.text(_url), findsOneWidget);
      },
    );

    testWidgets(
      'each of the three reachable codes renders its own distinct headline',
      (WidgetTester tester) async {
        await _pumpPushed(
          tester,
          error: const UrlUnreadableError('generic message'),
        );
        expect(find.text("Couldn't read that page"), findsOneWidget);

        await _pumpPushed(
          tester,
          error: const AiUnparseableError('generic message'),
          preservedInput: _pastedText,
          inputLabel: 'Pasted text',
        );
        expect(find.text("Couldn't understand that recipe"), findsOneWidget);

        await _pumpPushed(
          tester,
          error: const AiUnavailableError('generic message'),
          preservedInput: _pastedText,
          inputLabel: 'Pasted text',
        );
        expect(
          find.text("Recipe import isn't available right now"),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'never offers a retry affordance — every code that reaches this screen is non-retryable',
      (WidgetTester tester) async {
        for (final AppError error in <AppError>[
          const UrlUnreadableError('generic message'),
          const AiUnparseableError('generic message'),
          const AiUnavailableError('generic message'),
        ]) {
          await _pumpPushed(tester, error: error);

          expect(find.textContaining('Try again'), findsNothing);
          expect(find.text('Retry'), findsNothing);
        }
      },
    );

    testWidgets(
      'an unrecognised future AppError degrades to a generic, non-blank headline',
      (WidgetTester tester) async {
        await _pumpPushed(
          tester,
          error: const InternalError('An unexpected error occurred.'),
        );

        expect(find.text('Couldn\'t import that recipe'), findsOneWidget);
        expect(find.text('An unexpected error occurred.'), findsOneWidget);
        expect(find.byKey(AiFailureScreen.preservedInputKey), findsOneWidget);
      },
    );

    testWidgets(
      '"Paste the text instead" is offered for a URL-import failure (a genuine alternative)',
      (WidgetTester tester) async {
        await _pumpPushed(
          tester,
          error: const UrlUnreadableError('generic message'),
        );

        expect(
          find.byKey(AiFailureScreen.pasteInsteadButtonKey),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      '"Paste the text instead" is NOT offered for a freeform-paste failure — already on that path',
      (WidgetTester tester) async {
        for (final AppError error in <AppError>[
          const AiUnparseableError('generic message'),
          const AiUnavailableError('generic message'),
        ]) {
          await _pumpPushed(
            tester,
            error: error,
            preservedInput: _pastedText,
            inputLabel: 'Pasted text',
          );

          expect(
            find.byKey(AiFailureScreen.pasteInsteadButtonKey),
            findsNothing,
          );
        }
      },
    );

    testWidgets(
      '"Enter details manually" opens a real (empty) RecipeFormScreen',
      (WidgetTester tester) async {
        await _pumpPushed(
          tester,
          error: const UrlUnreadableError('generic message'),
        );

        await tester.tap(find.byKey(AiFailureScreen.manualEntryButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(RecipeFormScreen), findsOneWidget);
        final RecipeFormScreen form = tester.widget<RecipeFormScreen>(
          find.byType(RecipeFormScreen),
        );
        expect(form.initialRecipe, isNull);
        expect(form.initialDraft, isNull);
      },
    );

    testWidgets('"Paste the text instead" opens FreeformInputScreen', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        error: const UrlUnreadableError('generic message'),
      );

      await tester.tap(find.byKey(AiFailureScreen.pasteInsteadButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(FreeformInputScreen), findsOneWidget);
    });

    testWidgets('the top-bar back button pops', (WidgetTester tester) async {
      await _pumpPushed(
        tester,
        error: const UrlUnreadableError('generic message'),
      );

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(find.byType(AiFailureScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });
  });
}
