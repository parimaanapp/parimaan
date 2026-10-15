import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/domain/recipe_validation.dart';
import 'package:mobile/features/recipes/presentation/ai_failure_screen.dart';
import 'package:mobile/features/recipes/presentation/freeform_input_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_draft_review_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

const AiRecipeDraft _rajmaDraft = AiRecipeDraft(title: 'Rajma Chawal');

/// Pushes `FreeformInputScreen` on top of a marker screen behind a real
/// `GoRouter` that also carries the review route it navigates to on
/// success — same two-route-plus-real-router harness shape as
/// `recipe_form_screen_test.dart`'s own (`context.push`/`context.pop` both
/// need a real `GoRouter` ancestor).
Future<ProviderContainer> _pumpPushed(
  WidgetTester tester, {
  required FakeRecipeRepository repository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);

  final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: ElevatedButton(
                onPressed: () => context.push('/freeform?householdId=household-1'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/freeform',
        builder: (BuildContext context, GoRouterState state) =>
            const FreeformInputScreen(householdId: 'household-1'),
      ),
      // `FreeformInputScreen` navigates via the real `AppRoutes
      // .recipeDraftReview` on submit, so this harness's review route must
      // match that real pattern, not a synthetic one — unlike the plain
      // marker screens above, which the test itself pushes to.
      GoRoute(
        path: '/home/recipes/new/review',
        builder: (BuildContext context, GoRouterState state) {
          final RecipeDraftReviewExtra extra =
              state.extra as RecipeDraftReviewExtra;
          return RecipeDraftReviewScreen(
            householdId: 'household-1',
            draft: extra.draft,
            sourceUrl: extra.sourceUrl,
          );
        },
      ),
      // `FreeformInputScreen` navigates here for the two non-retryable AI
      // codes (`AiUnparseableError`/`AiUnavailableError`, W7 S11) — same
      // real-pattern reasoning as the review route above.
      GoRoute(
        path: '/home/recipes/new/ai-failure',
        builder: (BuildContext context, GoRouterState state) {
          final AiFailureExtra extra = state.extra as AiFailureExtra;
          return AiFailureScreen(
            householdId: 'household-1',
            error: extra.error,
            preservedInput: extra.preservedInput,
            inputLabel: extra.inputLabel,
          );
        },
      ),
    ],
  );

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return container;
}

void main() {
  group('FreeformInputScreen', () {
    testWidgets('submit is disabled until text is entered', (WidgetTester tester) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      expect(
        tester
            .widget<PButton>(find.byKey(FreeformInputScreen.submitButtonKey))
            .onPressed,
        isNull,
      );

      await tester.enterText(
        find.byKey(FreeformInputScreen.textFieldKey),
        'Rajma Chawal: soak rajma overnight, pressure cook...',
      );
      await tester.pump();

      expect(
        tester
            .widget<PButton>(find.byKey(FreeformInputScreen.submitButtonKey))
            .onPressed,
        isNotNull,
      );
    });

    testWidgets('the counter blocks submit past the 4,000-char bound with no request sent', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository();
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(
        find.byKey(FreeformInputScreen.textFieldKey),
        'a' * (maxFreeformRecipeTextLength + 1),
      );
      await tester.pump();

      expect(
        find.text('${maxFreeformRecipeTextLength + 1} / $maxFreeformRecipeTextLength'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<PButton>(find.byKey(FreeformInputScreen.submitButtonKey))
            .onPressed,
        isNull,
      );
      expect(repository.parseFreeformRecipeCalls, isEmpty);
    });

    testWidgets(
      'a successful parse navigates to the review screen with the parsed draft',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..parseFreeformRecipeResult = _rajmaDraft;
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(
          find.byKey(FreeformInputScreen.textFieldKey),
          'Rajma Chawal: soak rajma overnight, pressure cook...',
        );
        await tester.pump();
        await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(
          repository.parseFreeformRecipeCalls,
          <String>['Rajma Chawal: soak rajma overnight, pressure cook...'],
        );
        expect(find.byType(RecipeDraftReviewScreen), findsOneWidget);
        expect(find.text('Rajma Chawal'), findsOneWidget);
      },
    );

    testWidgets('pasted text survives navigation to review and back', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..parseFreeformRecipeResult = _rajmaDraft;
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(
        find.byKey(FreeformInputScreen.textFieldKey),
        'Rajma Chawal: soak rajma overnight, pressure cook...',
      );
      await tester.pump();
      await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
      await tester.pumpAndSettle();

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(FreeformInputScreen.textFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Rajma Chawal: soak rajma overnight, pressure cook...',
      );
    });

    testWidgets('a parse failure renders inline with a retry affordance', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..parseFreeformRecipeError = const ValidationError('text is too short to parse');
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(
        find.byKey(FreeformInputScreen.textFieldKey),
        'too short',
      );
      await tester.pump();
      await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('text is too short to parse'), findsOneWidget);
      expect(find.byKey(FreeformInputScreen.retryButtonKey), findsOneWidget);
      expect(find.byType(FreeformInputScreen), findsOneWidget);
    });

    testWidgets(
      'AI_BUSY renders inline with a retry affordance — never routed to the fallback screen',
      (WidgetTester tester) async {
        const error = AiBusyError('The AI service is busy. Try again in a moment.');
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..parseFreeformRecipeError = error;
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(
          find.byKey(FreeformInputScreen.textFieldKey),
          'Rajma Chawal: soak rajma overnight, pressure cook...',
        );
        await tester.pump();
        await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(find.text(error.errorMessage), findsOneWidget);
        expect(find.byKey(FreeformInputScreen.retryButtonKey), findsOneWidget);
        expect(find.byType(AiFailureScreen), findsNothing);
      },
    );

    testWidgets(
      'AI_TIMEOUT renders inline with a retry affordance — never routed to the fallback screen',
      (WidgetTester tester) async {
        const error = AiTimeoutError('The AI service took too long to respond.');
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..parseFreeformRecipeError = error;
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(
          find.byKey(FreeformInputScreen.textFieldKey),
          'Rajma Chawal: soak rajma overnight, pressure cook...',
        );
        await tester.pump();
        await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(find.text(error.errorMessage), findsOneWidget);
        expect(find.byKey(FreeformInputScreen.retryButtonKey), findsOneWidget);
        expect(find.byType(AiFailureScreen), findsNothing);
      },
    );

    testWidgets('a rate-limited failure renders inline with no retry affordance', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..parseFreeformRecipeError = const RateLimitedError(
          "You've reached today's limit for AI recipe parsing.",
        );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(
        find.byKey(FreeformInputScreen.textFieldKey),
        'Rajma Chawal: soak rajma overnight, pressure cook...',
      );
      await tester.pump();
      await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(
        find.text("You've reached today's limit for AI recipe parsing."),
        findsOneWidget,
      );
      expect(find.byKey(FreeformInputScreen.retryButtonKey), findsNothing);
    });

    testWidgets(
      'AI_UNPARSEABLE routes to the AI failure fallback screen with the pasted text preserved',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..parseFreeformRecipeError = const AiUnparseableError(
            'Could not understand the AI response.',
          );
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(
          find.byKey(FreeformInputScreen.textFieldKey),
          'Rajma Chawal: soak rajma overnight, pressure cook...',
        );
        await tester.pump();
        await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(AiFailureScreen), findsOneWidget);
        expect(find.byKey(AiFailureScreen.preservedInputKey), findsOneWidget);
        expect(
          find.text('Rajma Chawal: soak rajma overnight, pressure cook...'),
          findsOneWidget,
        );
        expect(find.text('Could not understand the AI response.'), findsOneWidget);
        // No inline error/retry underneath — the fallback screen already
        // owns showing this failure.
        expect(find.byKey(FreeformInputScreen.retryButtonKey), findsNothing);
      },
    );

    testWidgets(
      'AI_UNAVAILABLE routes to the AI failure fallback screen too, with its own copy',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..parseFreeformRecipeError = const AiUnavailableError(
            'The AI service is unavailable right now.',
          );
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(
          find.byKey(FreeformInputScreen.textFieldKey),
          'Rajma Chawal: soak rajma overnight, pressure cook...',
        );
        await tester.pump();
        await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(AiFailureScreen), findsOneWidget);
        expect(find.text("Recipe import isn't available right now"), findsOneWidget);
        expect(find.text('The AI service is unavailable right now.'), findsOneWidget);
      },
    );

    testWidgets('tapping the top-bar back button actually pops', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(find.byType(FreeformInputScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets(
      'a slow parse stays cancellable — backing out mid-flight does not later push the review screen',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..parseFreeformRecipeResult = _rajmaDraft
          ..delay = const Duration(milliseconds: 500);
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(
          find.byKey(FreeformInputScreen.textFieldKey),
          'Rajma Chawal: soak rajma overnight, pressure cook...',
        );
        await tester.pump();
        await tester.tap(find.byKey(FreeformInputScreen.submitButtonKey));
        await tester.pump();

        // Still cancellable — actually tap it mid-flight, before the
        // pending parse resolves, and confirm it really pops rather than
        // merely being present on screen. This exercises the same
        // `PopScope.onPopInvokedWithResult` path any pop takes — the
        // in-app button here, but identically Android's hardware/gesture
        // back or iOS's edge-swipe.
        await tester.tap(find.byType(PTopBarBackButton));
        await tester.pumpAndSettle();

        expect(find.byType(FreeformInputScreen), findsNothing);
        expect(find.text('open'), findsOneWidget);
        // The pending parse must not push the review screen on top of
        // wherever the user backed out to once it resolves.
        expect(find.byType(RecipeDraftReviewScreen), findsNothing);
      },
    );
  });
}
