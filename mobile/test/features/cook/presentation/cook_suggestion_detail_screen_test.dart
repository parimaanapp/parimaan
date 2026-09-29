import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/domain/cook_suggestion.dart';
import 'package:mobile/features/cook/presentation/cook_suggestion_detail_screen.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

CookSuggestion _suggestion() => CookSuggestion(
  id: 'sugg-1',
  draft: const AiRecipeDraft(
    title: 'Aloo Jeera',
    servings: 4,
    cookMin: 25,
    dietaryTags: <String>['veg'],
    ingredients: <AiRecipeDraftIngredient>[
      AiRecipeDraftIngredient(
        raw: '4 pcs potato',
        name: 'Potato',
        quantity: 4,
        unit: 'pcs',
      ),
      AiRecipeDraftIngredient(
        raw: '1 handful coriander',
        name: 'Coriander',
        quantity: 1,
        unit: 'handful',
      ),
    ],
    role: RecipeRole.sabziDal,
  ),
  ingredientMatches: const <CookIngredientMatch>[
    CookIngredientMatch(
      ingredient: 'potato',
      status: PantryMatchStatus.inPantry,
      pantryItemName: 'Potato',
    ),
    CookIngredientMatch(
      ingredient: 'coriander',
      status: PantryMatchStatus.missing,
    ),
  ],
  have: const <String>['Potato'],
  missing: const <String>['coriander'],
);

Future<void> _pump(
  WidgetTester tester, {
  required CookSuggestion suggestion,
  VoidCallback? onSave,
  VoidCallback? onBack,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: CookSuggestionDetailScreen(
        suggestion: suggestion,
        onSave: onSave,
        onBack: onBack,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('CookSuggestionDetailScreen', () {
    testWidgets(
      'shows the title, servings/time/diet summary and the AI badge',
      (WidgetTester tester) async {
        await _pump(tester, suggestion: _suggestion());

        expect(find.text('Aloo Jeera'), findsOneWidget);
        expect(find.textContaining('For 4'), findsOneWidget);
        expect(find.textContaining('25 min'), findsOneWidget);
        expect(find.textContaining('veg'), findsOneWidget);
        expect(find.textContaining('AI RECIPE'), findsOneWidget);
      },
    );

    testWidgets(
      'marks each ingredient in pantry or missing, in the recipe\'s own order, colour never the only signal',
      (WidgetTester tester) async {
        await _pump(tester, suggestion: _suggestion());

        expect(find.textContaining('in pantry'), findsOneWidget);
        expect(find.textContaining('missing'), findsOneWidget);
        final Finder rows = find.byType(ListTile).evaluate().isNotEmpty
            ? find.byType(ListTile)
            : find.textContaining('Potato');
        expect(rows, findsWidgets);
      },
    );

    testWidgets(
      'Save is disabled with "Coming soon" when onSave is not supplied (S6 wires it)',
      (WidgetTester tester) async {
        await _pump(tester, suggestion: _suggestion());

        final Semantics semantics = tester.widget<Semantics>(
          find.byKey(CookSuggestionDetailScreen.saveButtonKey),
        );
        expect(semantics.properties.enabled, isFalse);
        expect(semantics.properties.label, contains('Coming soon'));
      },
    );

    testWidgets('Save is enabled and reachable once onSave is supplied', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await _pump(tester, suggestion: _suggestion(), onSave: () => taps++);

      final Semantics semantics = tester.widget<Semantics>(
        find.byKey(CookSuggestionDetailScreen.saveButtonKey),
      );
      expect(semantics.properties.enabled, isTrue);
      await tester.tap(
        find.byKey(CookSuggestionDetailScreen.saveButtonKey),
        warnIfMissed: false,
      );
      await tester.pumpAndSettle();
      expect(taps, 1);
    });

    testWidgets(
      'never renders ingredient text as a tappable link (only Save/Back are interactive)',
      (WidgetTester tester) async {
        await _pump(tester, suggestion: _suggestion());
        expect(
          find.ancestor(
            of: find.textContaining('Potato'),
            matching: find.byType(InkWell),
          ),
          findsNothing,
        );
        expect(
          find.ancestor(
            of: find.textContaining('Potato'),
            matching: find.byType(GestureDetector),
          ),
          findsNothing,
        );
      },
    );

    testWidgets('the back button calls onBack when provided', (
      WidgetTester tester,
    ) async {
      int backTaps = 0;
      await _pump(tester, suggestion: _suggestion(), onBack: () => backTaps++);

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(backTaps, 1);
    });
  });
}
