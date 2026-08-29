import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/presentation/ai_failure_screen.dart';
import 'package:mobile/features/recipes/presentation/freeform_input_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_draft_review_screen.dart';
import 'package:mobile/features/recipes/presentation/url_import_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

const AiRecipeDraft _rajmaDraft = AiRecipeDraft(title: 'Rajma Chawal');
const String _rajmaUrl = 'https://example.com/rajma-chawal';

/// Mocks the clipboard's read side (`Clipboard.getData`) — like
/// `invite_code_screen_test.dart`'s own `_interceptClipboard` for the write
/// side, this is a platform-channel call that no-ops in a widget test
/// unless mocked.
void _mockClipboardText(WidgetTester tester, String? text) {
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (MethodCall call) async {
      if (call.method == 'Clipboard.getData') {
        return text == null ? null : <String, dynamic>{'text': text};
      }
      return null;
    },
  );
  addTearDown(
    () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    ),
  );
}

/// Pushes `UrlImportScreen` behind a real `GoRouter` that also carries the
/// review and AI-failure routes it navigates to internally via
/// `AppRoutes` — same shape as `freeform_input_screen_test.dart`'s harness.
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
                onPressed: () => context.push('/url?householdId=household-1'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/url',
        builder: (BuildContext context, GoRouterState state) =>
            const UrlImportScreen(householdId: 'household-1'),
      ),
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
      GoRoute(
        path: '/home/recipes/new/ai-failure',
        builder: (BuildContext context, GoRouterState state) {
          final AiFailureExtra extra = state.extra as AiFailureExtra;
          return AiFailureScreen(
            householdId: 'household-1',
            errorMessage: extra.errorMessage,
            preservedInput: extra.preservedInput,
          );
        },
      ),
      GoRoute(
        path: '/home/recipes/new/freeform',
        builder: (BuildContext context, GoRouterState state) =>
            const FreeformInputScreen(householdId: 'household-1'),
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

bool _submitEnabled(WidgetTester tester) =>
    tester.widget<PButton>(find.byKey(UrlImportScreen.submitButtonKey)).onPressed !=
    null;

void main() {
  group('UrlImportScreen', () {
    testWidgets('submit is disabled until the field parses as an https URL', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      expect(_submitEnabled(tester), isFalse);

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), 'not a url');
      await tester.pump();
      expect(_submitEnabled(tester), isFalse);

      await tester.enterText(
        find.byKey(UrlImportScreen.urlFieldKey),
        'http://example.com/recipe',
      );
      await tester.pump();
      expect(_submitEnabled(tester), isFalse, reason: 'http, not https');

      await tester.enterText(
        find.byKey(UrlImportScreen.urlFieldKey),
        'example.com/recipe',
      );
      await tester.pump();
      expect(_submitEnabled(tester), isFalse, reason: 'no scheme at all');

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
      await tester.pump();
      expect(_submitEnabled(tester), isTrue);
    });

    testWidgets('the paste affordance fills the field from the clipboard', (
      WidgetTester tester,
    ) async {
      _mockClipboardText(tester, _rajmaUrl);
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.tap(find.byKey(UrlImportScreen.pasteButtonKey));
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(UrlImportScreen.urlFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        _rajmaUrl,
      );
    });

    testWidgets(
      'navigating away while a clipboard read is still pending does not throw',
      (WidgetTester tester) async {
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          (MethodCall call) async {
            if (call.method == 'Clipboard.getData') {
              await Future<void>.delayed(const Duration(milliseconds: 200));
              return <String, dynamic>{'text': _rajmaUrl};
            }
            return null;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            SystemChannels.platform,
            null,
          ),
        );
        await _pumpPushed(tester, repository: FakeRecipeRepository());

        // Fires the paste (clipboard read still pending) then immediately
        // pops the screen before it resolves.
        await tester.tap(find.byKey(UrlImportScreen.pasteButtonKey));
        await tester.pump();
        await tester.tap(find.byType(PTopBarBackButton));
        await tester.pump(const Duration(milliseconds: 300));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.byType(UrlImportScreen), findsNothing);
      },
    );

    testWidgets('a slow response shows an honest in-flight state and stays cancellable', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..importRecipeFromUrlResult = _rajmaDraft
        ..delay = const Duration(milliseconds: 500);
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
      await tester.pump();
      await tester.tap(find.byKey(UrlImportScreen.submitButtonKey));
      await tester.pump();

      expect(find.byKey(UrlImportScreen.inFlightIndicatorKey), findsOneWidget);
      expect(find.textContaining('This can take'), findsOneWidget);

      // Still cancellable — actually tap it mid-flight, before the pending
      // import resolves, and confirm it really pops rather than merely
      // being present on screen. This exercises the same `PopScope.
      // onPopInvokedWithResult` path any pop takes — the in-app button
      // here, but identically Android's hardware/gesture back or iOS's
      // edge-swipe, none of which are special-cased separately in
      // `UrlImportScreen` itself.
      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(find.byType(UrlImportScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
      // The pending import must not push the review screen on top of
      // wherever the user backed out to once it resolves.
      expect(find.byType(RecipeDraftReviewScreen), findsNothing);
    });

    testWidgets('a successful import navigates to review with sourceUrl set', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..importRecipeFromUrlResult = _rajmaDraft;
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
      await tester.pump();
      await tester.tap(find.byKey(UrlImportScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.importRecipeFromUrlCalls, <String>[_rajmaUrl]);
      expect(find.byType(RecipeDraftReviewScreen), findsOneWidget);
      expect(find.text('From $_rajmaUrl'), findsOneWidget);
    });

    testWidgets('URL_UNREADABLE routes to the AI failure fallback screen with the URL preserved', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..importRecipeFromUrlError = const UrlUnreadableError(
          "Couldn't read that page. Try pasting the recipe text instead.",
        );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
      await tester.pump();
      await tester.tap(find.byKey(UrlImportScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(AiFailureScreen), findsOneWidget);
      expect(find.byKey(AiFailureScreen.preservedInputKey), findsOneWidget);
      expect(find.text(_rajmaUrl), findsOneWidget);
      expect(
        find.text("Couldn't read that page. Try pasting the recipe text instead."),
        findsOneWidget,
      );
    });

    testWidgets('a RATE_LIMITED failure renders inline with no retry affordance', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..importRecipeFromUrlError = const RateLimitedError(
          "You've reached today's limit for recipe imports.",
        );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
      await tester.pump();
      await tester.tap(find.byKey(UrlImportScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(
        find.text("You've reached today's limit for recipe imports."),
        findsOneWidget,
      );
      expect(find.byKey(UrlImportScreen.retryButtonKey), findsNothing);
      expect(find.byType(AiFailureScreen), findsNothing);
      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(UrlImportScreen.urlFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        _rajmaUrl,
      );
    });

    testWidgets('a generic (non-URL_UNREADABLE) failure renders inline with a retry affordance', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository()
        ..importRecipeFromUrlError = const ValidationError('url must be an https URL');
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
      await tester.pump();
      await tester.tap(find.byKey(UrlImportScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('url must be an https URL'), findsOneWidget);
      expect(find.byKey(UrlImportScreen.retryButtonKey), findsOneWidget);
      expect(find.byType(AiFailureScreen), findsNothing);
    });

    testWidgets(
      'the entered URL survives the inline-retry failure path (RATE_LIMITED and URL_UNREADABLE are covered by their own tests above)',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository()
          ..importRecipeFromUrlError = const ValidationError('url must be an https URL');
        await _pumpPushed(tester, repository: repository);

        await tester.enterText(find.byKey(UrlImportScreen.urlFieldKey), _rajmaUrl);
        await tester.pump();
        await tester.tap(find.byKey(UrlImportScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(
          tester
              .widget<TextField>(
                find.descendant(
                  of: find.byKey(UrlImportScreen.urlFieldKey),
                  matching: find.byType(TextField),
                ),
              )
              .controller
              ?.text,
          _rajmaUrl,
        );
      },
    );

    testWidgets('the "paste text instead" affordance is co-equal and always present', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.tap(find.byKey(UrlImportScreen.pasteInsteadButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(FreeformInputScreen), findsOneWidget);
    });

    testWidgets('tapping the top-bar back button actually pops', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(find.byType(UrlImportScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });
  });
}
