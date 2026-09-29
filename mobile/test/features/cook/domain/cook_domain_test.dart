import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/domain/cook_suggestion.dart';
import 'package:mobile/features/cook/domain/cook_vibe.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';

CookSuggestion _suggestion({List<String> have = const <String>['Potato']}) =>
    CookSuggestion(
      id: 'abc',
      draft: const AiRecipeDraft(title: 'Aloo Jeera'),
      ingredientMatches: <CookIngredientMatch>[
        const CookIngredientMatch(
          ingredient: 'potato',
          status: PantryMatchStatus.inPantry,
          pantryItemName: 'Potato',
        ),
        const CookIngredientMatch(
          ingredient: 'coriander',
          status: PantryMatchStatus.missing,
        ),
      ],
      have: have,
      missing: <String>['coriander'],
    );

void main() {
  group('CookVibe', () {
    test('has the four wireframe chips, in order, with their labels', () {
      expect(CookVibe.values.map((CookVibe v) => v.label).toList(), <String>[
        'Quick',
        'Weekend',
        'Kid-friendly',
        'Comfort',
      ]);
    });
  });

  group('CookSuggestion', () {
    test('has no way to look saved or persisted: no id-of-a-recipe, only its own key', () {
      final CookSuggestion s = _suggestion();
      expect(s.id, 'abc');
      expect(s.draft.title, 'Aloo Jeera');
    });

    test(
      'copies its lists, so a caller cannot change a result after the fact',
      () {
        final List<String> have = <String>['Potato'];
        final CookSuggestion s = _suggestion(have: have);
        have.add('Sneaky');
        expect(s.have, <String>['Potato']);
        expect(() => s.have.add('x'), throwsUnsupportedError);
        expect(
          () => s.ingredientMatches.add(s.ingredientMatches.first),
          throwsUnsupportedError,
        );
      },
    );

    test('has value equality, so a re-fetched identical result does not rebuild the screen', () {
      expect(_suggestion(), _suggestion());
      expect(_suggestion().hashCode, _suggestion().hashCode);
      expect(_suggestion(), isNot(_suggestion(have: <String>['Other'])));
    });
  });

  group('CookIngredientMatch', () {
    test(
      'a pantry name is present if and only if the ingredient is in the pantry',
      () {
        expect(
          () => CookIngredientMatch(
            ingredient: 'x',
            status: PantryMatchStatus.missing,
            pantryItemName: 'X',
          ),
          throwsA(isA<AssertionError>()),
        );
        expect(
          () => CookIngredientMatch(
            ingredient: 'x',
            status: PantryMatchStatus.inPantry,
          ),
          throwsA(isA<AssertionError>()),
        );
      },
    );
  });

  group('CookFromPantryResult', () {
    test('has value equality, so two identical results compare equal', () {
      final CookFromPantryResult a = CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        vibe: CookVibe.quick,
        suggestions: <CookSuggestion>[_suggestion()],
      );
      final CookFromPantryResult b = CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        vibe: CookVibe.quick,
        suggestions: <CookSuggestion>[_suggestion()],
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(
        a,
        isNot(
          CookFromPantryResult(
            outcome: CookOutcome.suggestions,
            vibe: CookVibe.weekend,
            suggestions: <CookSuggestion>[_suggestion()],
          ),
        ),
      );
    });

    test('carries suggestions only for the suggestions outcome', () {
      expect(
        () => CookFromPantryResult(
          outcome: CookOutcome.pantryTooSmall,
          suggestions: <CookSuggestion>[_suggestion()],
        ),
        throwsA(isA<AssertionError>()),
      );
      final CookFromPantryResult ok = CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        vibe: CookVibe.quick,
        suggestions: <CookSuggestion>[_suggestion()],
      );
      expect(ok.suggestions, hasLength(1));
      expect(ok.vibe, CookVibe.quick);
    });
  });
}
