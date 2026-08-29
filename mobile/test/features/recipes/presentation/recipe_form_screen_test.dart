import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/ai_proposal.dart';
import 'package:mobile/features/recipes/presentation/ingredient_row_editor.dart';
import 'package:mobile/features/recipes/presentation/recipe_form_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

final Recipe _dalRecipe = Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Toor Dal',
  description: 'A weeknight staple.',
  servings: 4,
  prepMin: 10,
  cookMin: 20,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: true,
  isFavorite: false,
  ingredients: const <RecipeIngredient>[
    RecipeIngredient(
      id: 'ing-1',
      name: 'Toor dal',
      quantity: 1,
      unit: 'cup',
      isStaple: true,
      category: 'dal',
      notes: 'Split, not whole.',
    ),
  ],
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

/// Pushes [RecipeFormScreen] via a real (minimal) `GoRouter` — the screen's
/// own back button and successful-submit path both call `context.pop()`
/// (`go_router`'s extension), which needs a real `GoRouter` ancestor, the
/// same reason `recipe_overflow_menu_test.dart`'s harness moved off a plain
/// `MaterialApp`.
Future<ProviderContainer> _pumpPushed(
  WidgetTester tester, {
  required FakeRecipeRepository repository,
  String householdId = 'household-1',
  Recipe? initialRecipe,
  AiRecipeDraft? initialDraft,
  String? sourceUrl,
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
          body: Center(
            child: ElevatedButton(
              onPressed: () => context.push('/form'),
              child: const Text('open'),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/form',
        builder: (BuildContext context, GoRouterState state) => RecipeFormScreen(
          householdId: householdId,
          initialRecipe: initialRecipe,
          initialDraft: initialDraft,
          sourceUrl: sourceUrl,
        ),
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

const AiRecipeDraft _rajmaDraft = AiRecipeDraft(
  title: 'Rajma Chawal',
  servings: 4,
  role: RecipeRole.sabziDal,
  ingredients: <AiRecipeDraftIngredient>[
    AiRecipeDraftIngredient(raw: '1 cup rajma', name: 'Rajma', quantity: 1, unit: 'cup'),
  ],
  steps: <String>['Soak the rajma overnight.'],
  warnings: <String>['Could not determine cuisineTier2.'],
);

bool _submitEnabled(WidgetTester tester) =>
    tester.widget<PButton>(find.byKey(RecipeFormScreen.submitButtonKey)).onPressed != null;

void main() {
  group('RecipeFormScreen — create mode', () {
    testWidgets('submit is disabled until a title is filled and a role is chosen', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      expect(_submitEnabled(tester), isFalse);

      await tester.enterText(
        find.byKey(RecipeFormScreen.titleFieldKey),
        'Toor Dal',
      );
      await tester.pump();

      // Title alone is not enough — role has no default and is required.
      expect(_submitEnabled(tester), isFalse);

      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();

      expect(_submitEnabled(tester), isTrue);
    });

    testWidgets('tapping a selected role chip again deselects it and blocks submit', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.enterText(
        find.byKey(RecipeFormScreen.titleFieldKey),
        'Toor Dal',
      );
      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();
      expect(_submitEnabled(tester), isTrue);

      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();

      expect(_submitEnabled(tester), isFalse);
    });

    testWidgets('adding then removing an ingredient row preserves the other rows\' values', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.ensureVisible(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.pump();
      await tester.ensureVisible(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.pump();

      await tester.ensureVisible(find.byKey(IngredientRowEditor.nameFieldKey(0)));
      await tester.enterText(
        find.byKey(IngredientRowEditor.nameFieldKey(0)),
        'Toor Dal',
      );
      await tester.ensureVisible(find.byKey(IngredientRowEditor.nameFieldKey(1)));
      await tester.enterText(
        find.byKey(IngredientRowEditor.nameFieldKey(1)),
        'Rice',
      );
      await tester.pump();

      await tester.ensureVisible(find.byKey(IngredientRowEditor.removeButtonKey(0)));
      await tester.tap(find.byKey(IngredientRowEditor.removeButtonKey(0)));
      await tester.pump();

      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(IngredientRowEditor.nameFieldKey(0)),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Rice',
      );
    });

    testWidgets('reordering the ingredient rows changes the order sent on submit', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createResult: _dalRecipe,
      );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(RecipeFormScreen.titleFieldKey), 'Toor Dal');
      await tester.tap(find.text('Sabzi/Dal'));
      await tester.ensureVisible(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.pump();
      await tester.ensureVisible(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.pump();

      await tester.ensureVisible(find.byKey(IngredientRowEditor.nameFieldKey(0)));
      await tester.enterText(find.byKey(IngredientRowEditor.nameFieldKey(0)), 'Ingredient A');
      await tester.ensureVisible(find.byKey(IngredientRowEditor.nameFieldKey(1)));
      await tester.enterText(find.byKey(IngredientRowEditor.nameFieldKey(1)), 'Ingredient B');
      await tester.pump();

      // The drag handle icon, not the text field — a plain `drag` gesture
      // is enough since the rows use `ReorderableDragStartListener` (no
      // long-press required, unlike `ReorderableDelayedDragStartListener`).
      await tester.ensureVisible(find.byIcon(Icons.drag_handle).first);
      await tester.drag(find.byIcon(Icons.drag_handle).first, const Offset(0, 200));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.createCalls, hasLength(1));
      final List<String> submittedNames = repository.createCalls.single.draft.ingredients
          .map((ingredient) => ingredient.name)
          .toList();
      expect(submittedNames, <String>['Ingredient B', 'Ingredient A']);
    });

    testWidgets('submitting calls createRecipe with the built draft and pops back', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createResult: _dalRecipe,
      );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(RecipeFormScreen.titleFieldKey), 'Toor Dal');
      await tester.tap(find.text('Sabzi/Dal'));
      await tester.enterText(find.byKey(RecipeFormScreen.servingsFieldKey), '4');
      await tester.pump();
      await tester.ensureVisible(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.createCalls, hasLength(1));
      final call = repository.createCalls.single;
      expect(call.householdId, 'household-1');
      expect(call.draft.title, 'Toor Dal');
      expect(call.draft.role, RecipeRole.sabziDal);
      expect(call.draft.servings, 4);
      // A structured create must never send a `source` attribution — that
      // argument exists only for the review-mode confirm path (W7 S10).
      expect(call.source, isNull);
      expect(find.byType(RecipeFormScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets('renders no AI-proposal badge — that treatment is review-mode only', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester, repository: FakeRecipeRepository());

      await tester.enterText(find.byKey(RecipeFormScreen.titleFieldKey), 'Toor Dal');
      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();

      expect(find.byKey(AIProposal.proposedBadgeKey), findsNothing);
    });

    testWidgets('a server VALIDATION error renders inline and does not pop', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createError: const ValidationError('title must not be empty'),
      );
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(RecipeFormScreen.titleFieldKey), 'Toor Dal');
      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('title must not be empty'), findsOneWidget);
      expect(find.byType(RecipeFormScreen), findsOneWidget);
    });

    testWidgets('cancel (back) mutates nothing', (WidgetTester tester) async {
      final FakeRecipeRepository repository = FakeRecipeRepository();
      await _pumpPushed(tester, repository: repository);

      await tester.enterText(find.byKey(RecipeFormScreen.titleFieldKey), 'Toor Dal');
      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(repository.createCalls, isEmpty);
      expect(find.text('open'), findsOneWidget);
    });
  });

  group('RecipeFormScreen — edit mode', () {
    testWidgets('renders no AI-proposal badge — that treatment is review-mode only', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialRecipe: _dalRecipe,
      );

      expect(find.byKey(AIProposal.proposedBadgeKey), findsNothing);
    });

    testWidgets('seeds every field from the existing recipe', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialRecipe: _dalRecipe,
      );

      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(RecipeFormScreen.titleFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Toor Dal',
      );
      expect(
        tester
            .widget<PChip>(
              find.ancestor(
                of: find.text('Sabzi/Dal'),
                matching: find.byType(PChip),
              ),
            )
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(IngredientRowEditor.nameFieldKey(0)),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Toor dal',
      );
    });

    testWidgets('submitting with only the title changed sends a patch with only that field', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        updateResult: _dalRecipe,
      );
      await _pumpPushed(
        tester,
        repository: repository,
        initialRecipe: _dalRecipe,
      );

      await tester.enterText(
        find.byKey(RecipeFormScreen.titleFieldKey),
        'Toor Dal (updated)',
      );
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.updateCalls, hasLength(1));
      final patch = repository.updateCalls.single.patch;
      expect(patch.title, 'Toor Dal (updated)');
      expect(patch.description, isNull);
      expect(patch.servings, isNull);
      expect(patch.role, isNull);
      expect(patch.ingredients, isNull);
      expect(patch.steps, isNull);
    });

    testWidgets('editing the ingredient list sends the whole current list even though nothing else changed', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        updateResult: _dalRecipe,
      );
      await _pumpPushed(
        tester,
        repository: repository,
        initialRecipe: _dalRecipe,
      );

      await tester.enterText(
        find.byKey(IngredientRowEditor.nameFieldKey(0)),
        'Toor dal (organic)',
      );
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.updateCalls, hasLength(1));
      final patch = repository.updateCalls.single.patch;
      expect(patch.title, isNull);
      expect(patch.ingredients, isNotNull);
      expect(patch.ingredients!.single.name, 'Toor dal (organic)');
      // `category`/`notes` aren't editable by this form (no UI for either),
      // but `ingredients` is a whole-list-replace patch field — round-trip
      // regression coverage for the bug found by `code-reviewer` where an
      // edited ingredient list silently nulled out both on every ingredient
      // in the recipe, not just the row actually touched.
      expect(patch.ingredients!.single.category, 'dal');
      expect(patch.ingredients!.single.notes, 'Split, not whole.');
      expect(patch.steps, isNull);
    });

    testWidgets('submitting with nothing changed sends no request and just pops', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        updateResult: _dalRecipe,
      );
      await _pumpPushed(
        tester,
        repository: repository,
        initialRecipe: _dalRecipe,
      );

      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.updateCalls, isEmpty);
      expect(find.byType(RecipeFormScreen), findsNothing);
    });
  });

  group('RecipeFormScreen — review mode (W7 S10)', () {
    testWidgets('seeds every populated draft field and leaves absent ones empty', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialDraft: _rajmaDraft,
      );

      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(RecipeFormScreen.titleFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Rajma Chawal',
      );
      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(RecipeFormScreen.descriptionFieldKey),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        '',
      );
      expect(
        tester
            .widget<TextField>(
              find.descendant(
                of: find.byKey(IngredientRowEditor.nameFieldKey(0)),
                matching: find.byType(TextField),
              ),
            )
            .controller
            ?.text,
        'Rajma',
      );
    });

    testWidgets('proposed fields render with the AI-suggests badge', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialDraft: _rajmaDraft,
      );

      expect(
        find.byKey(AIProposal.proposedBadgeKey),
        // title, servings, role, ingredients, steps — every populated field
        // (description/prepMin/cookMin are absent on the fixture draft, so
        // render as ordinary empty fields, no badge).
        findsNWidgets(5),
      );
    });

    testWidgets('editing a proposed field loses its badge', (WidgetTester tester) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialDraft: _rajmaDraft,
      );

      final int badgesBefore = tester.widgetList(find.byKey(AIProposal.proposedBadgeKey)).length;

      await tester.enterText(
        find.byKey(RecipeFormScreen.titleFieldKey),
        'Rajma Chawal (mine)',
      );
      await tester.pump();

      final int badgesAfter = tester.widgetList(find.byKey(AIProposal.proposedBadgeKey)).length;
      expect(badgesAfter, badgesBefore - 1);
    });

    testWidgets('clearing a proposed numeric field to empty loses its badge', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialDraft: _rajmaDraft,
      );

      final int badgesBefore = tester.widgetList(find.byKey(AIProposal.proposedBadgeKey)).length;

      await tester.enterText(find.byKey(RecipeFormScreen.servingsFieldKey), '');
      await tester.pump();

      final int badgesAfter = tester.widgetList(find.byKey(AIProposal.proposedBadgeKey)).length;
      expect(badgesAfter, badgesBefore - 1);
    });

    testWidgets('adding an ingredient row in review mode loses the ingredients badge', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialDraft: _rajmaDraft,
      );

      final int badgesBefore = tester.widgetList(find.byKey(AIProposal.proposedBadgeKey)).length;

      await tester.ensureVisible(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.addIngredientButtonKey));
      await tester.pump();

      final int badgesAfter = tester.widgetList(find.byKey(AIProposal.proposedBadgeKey)).length;
      expect(badgesAfter, badgesBefore - 1);
    });

    testWidgets(
      'role is not silently pre-selected — submit stays blocked until affirmatively confirmed or changed',
      (WidgetTester tester) async {
        await _pumpPushed(
          tester,
          repository: FakeRecipeRepository(),
          initialDraft: _rajmaDraft,
        );

        // Title/servings/ingredients/steps are all already populated by the
        // draft, but the proposed (untouched) role must still block submit.
        expect(_submitEnabled(tester), isFalse);

        // The proposed role itself — this is the `.accept()` path.
        await tester.tap(find.text('Sabzi/Dal'));
        await tester.pump();

        expect(_submitEnabled(tester), isTrue);
      },
    );

    testWidgets(
      'tapping a different role than the one proposed takes the .edit() path and unblocks submit',
      (WidgetTester tester) async {
        await _pumpPushed(
          tester,
          repository: FakeRecipeRepository(),
          initialDraft: _rajmaDraft,
        );

        expect(_submitEnabled(tester), isFalse);

        // `_rajmaDraft.role` is `sabziDal` — a different chip exercises
        // `.edit()`, not `.accept()`.
        await tester.tap(find.text('Breakfast'));
        await tester.pump();

        expect(_submitEnabled(tester), isTrue);
        expect(
          tester
              .widget<PChip>(
                find.ancestor(of: find.text('Breakfast'), matching: find.byType(PChip)),
              )
              .selected,
          isTrue,
        );
      },
    );

    testWidgets('warnings render as non-blocking notes', (WidgetTester tester) async {
      await _pumpPushed(
        tester,
        repository: FakeRecipeRepository(),
        initialDraft: _rajmaDraft,
      );

      expect(find.byKey(RecipeFormScreen.reviewWarningsKey), findsOneWidget);
      expect(find.text('Could not determine cuisineTier2.'), findsOneWidget);
    });

    testWidgets(
      'confirm sends createRecipe with source freeform_ai when there is no sourceUrl',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          createResult: _dalRecipe,
        );
        await _pumpPushed(
          tester,
          repository: repository,
          initialDraft: _rajmaDraft,
        );

        await tester.tap(find.text('Sabzi/Dal'));
        await tester.pump();
        await tester.ensureVisible(find.byKey(RecipeFormScreen.submitButtonKey));
        await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
        await tester.pumpAndSettle();

        expect(repository.createCalls, hasLength(1));
        final call = repository.createCalls.single;
        expect(call.draft.title, 'Rajma Chawal');
        expect(call.source, isNotNull);
        expect(call.source!.sourceType, RecipeSource.freeformAi);
        expect(call.source!.sourceUrl, isNull);
      },
    );

    testWidgets('confirm sends createRecipe with source url and sourceUrl when importing from a URL', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(createResult: _dalRecipe);
      await _pumpPushed(
        tester,
        repository: repository,
        initialDraft: _rajmaDraft,
        sourceUrl: 'https://example.com/rajma-chawal',
      );

      expect(find.text('From https://example.com/rajma-chawal'), findsOneWidget);

      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();
      await tester.ensureVisible(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(repository.createCalls, hasLength(1));
      final call = repository.createCalls.single;
      expect(call.source!.sourceType, RecipeSource.url);
      expect(call.source!.sourceUrl, 'https://example.com/rajma-chawal');
    });

    testWidgets('a VALIDATION error from createRecipe renders inline without losing the draft', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createError: const ValidationError('title must not be empty'),
      );
      await _pumpPushed(
        tester,
        repository: repository,
        initialDraft: _rajmaDraft,
      );

      await tester.tap(find.text('Sabzi/Dal'));
      await tester.pump();
      await tester.tap(find.byKey(RecipeFormScreen.submitButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('title must not be empty'), findsOneWidget);
      expect(find.byType(RecipeFormScreen), findsOneWidget);
      expect(find.text('Rajma Chawal'), findsOneWidget);
    });

    testWidgets('cancel discards without writing anything', (WidgetTester tester) async {
      final FakeRecipeRepository repository = FakeRecipeRepository();
      await _pumpPushed(
        tester,
        repository: repository,
        initialDraft: _rajmaDraft,
      );

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(repository.createCalls, isEmpty);
      expect(find.text('open'), findsOneWidget);
    });
  });
}
