import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/cook/data/cook_repository.dart';
import 'package:mobile/features/cook/domain/cook_suggestion.dart';
import 'package:mobile/features/cook/domain/cook_vibe.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';

const String _householdId = 'household-1';

Map<String, dynamic> _draft({String title = 'Aloo Jeera'}) => <String, dynamic>{
  '__typename': 'RecipeDraft',
  'title': title,
  'description': null,
  'servings': 4,
  'prepMin': 5,
  'cookMin': 20,
  'cuisineTier1': 'north_indian',
  'cuisineTier2': null,
  'dietaryTags': <String>['veg'],
  'role': 'sabzi_dal',
  'ingredients': <Map<String, dynamic>>[
    <String, dynamic>{
      '__typename': 'RecipeDraftIngredient',
      'raw': 'potato',
      'name': 'potato',
      'quantity': 4.0,
      'unit': 'pcs',
      'notes': null,
    },
  ],
  'steps': <String>['Cook it.'],
  'sourceUrl': null,
  'warnings': <String>[],
};

Map<String, dynamic> _suggestion({
  String id = 'sugg-1',
  List<String> have = const <String>['Potato'],
}) => <String, dynamic>{
  '__typename': 'CookSuggestion',
  'id': id,
  'draft': _draft(),
  'ingredientMatches': <Map<String, dynamic>>[
    <String, dynamic>{
      '__typename': 'CookIngredientMatch',
      'ingredient': 'potato',
      'status': 'in_pantry',
      'pantryItemName': 'Potato',
    },
  ],
  'have': have,
  'missing': <String>[],
};

Map<String, dynamic> _body(
  String outcome, {
  String? vibe,
  List<Map<String, dynamic>> suggestions = const <Map<String, dynamic>>[],
}) => <String, dynamic>{
  'data': <String, dynamic>{
    'cookFromPantry': <String, dynamic>{
      '__typename': 'CookFromPantryResult',
      'outcome': outcome,
      'vibe': vibe,
      'suggestions': suggestions,
    },
  },
};

Map<String, dynamic> _errorBody(String errorType, String message) =>
    <String, dynamic>{
      'data': null,
      'errors': <dynamic>[
        <String, dynamic>{
          'path': <String>['cookFromPantry'],
          'errorType': errorType,
          'message': message,
        },
      ],
    };

({FerryCookRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryCookRepository(client: client), link: link);
}

void main() {
  group('FerryCookRepository', () {
    test('sends householdId and the vibe, and null for "any vibe"', () async {
      final s = _subject(
        (Request request) => _body(
          'suggestions',
          vibe: 'quick',
          suggestions: <Map<String, dynamic>>[_suggestion()],
        ),
      );
      await s.repository.cookFromPantry(
        householdId: _householdId,
        vibe: CookVibe.quick,
      );
      final Map<String, dynamic> vars = s.link.requests.single.variables;
      expect(vars['householdId'], _householdId);
      expect(vars['vibe'], 'quick');

      await s.repository.cookFromPantry(householdId: _householdId, vibe: null);
      expect(s.link.requests.last.variables['vibe'], isNull);
    });

    test('maps a suggestions outcome to suggestions with grounding, echoing the vibe', () async {
      final s = _subject(
        (Request request) => _body(
          'suggestions',
          vibe: 'comfort',
          suggestions: <Map<String, dynamic>>[
            _suggestion(id: 'sugg-1', have: <String>['Potato']),
          ],
        ),
      );
      final CookFromPantryResult result = await s.repository.cookFromPantry(
        householdId: _householdId,
        vibe: CookVibe.comfort,
      );

      expect(result.outcome, CookOutcome.suggestions);
      expect(result.vibe, CookVibe.comfort);
      expect(result.suggestions, hasLength(1));
      final CookSuggestion suggestion = result.suggestions.single;
      expect(suggestion.id, 'sugg-1');
      expect(suggestion.draft.title, 'Aloo Jeera');
      expect(suggestion.have, <String>['Potato']);
      expect(
        suggestion.ingredientMatches.single.status,
        PantryMatchStatus.inPantry,
      );
      expect(suggestion.ingredientMatches.single.pantryItemName, 'Potato');
    });

    test('maps pantry_too_small and no_grounded_suggestions to their outcomes, with no vibe fallback lost', () async {
      final s1 = _subject(
        (Request request) => _body('pantry_too_small', vibe: 'quick'),
      );
      final r1 = await s1.repository.cookFromPantry(
        householdId: _householdId,
        vibe: CookVibe.quick,
      );
      expect(r1.outcome, CookOutcome.pantryTooSmall);
      expect(r1.suggestions, isEmpty);

      final s2 = _subject(
        (Request request) => _body('no_grounded_suggestions', vibe: null),
      );
      final r2 = await s2.repository.cookFromPantry(
        householdId: _householdId,
        vibe: null,
      );
      expect(r2.outcome, CookOutcome.noGroundedSuggestions);
      expect(r2.vibe, isNull);
    });

    test('a genuinely unrecognised ingredient-match status falls to missing, the conservative reading', () async {
      final s = _subject(
        (Request request) => <String, dynamic>{
          'data': <String, dynamic>{
            'cookFromPantry': <String, dynamic>{
              '__typename': 'CookFromPantryResult',
              'outcome': 'suggestions',
              'vibe': 'quick',
              'suggestions': <Map<String, dynamic>>[
                <String, dynamic>{
                  ..._suggestion(),
                  'ingredientMatches': <Map<String, dynamic>>[
                    <String, dynamic>{
                      '__typename': 'CookIngredientMatch',
                      'ingredient': 'x',
                      'status': 'a_future_status',
                      'pantryItemName': null,
                    },
                  ],
                },
              ],
            },
          },
        },
      );
      final CookFromPantryResult result = await s.repository.cookFromPantry(
        householdId: _householdId,
        vibe: CookVibe.quick,
      );
      expect(
        result.suggestions.single.ingredientMatches.single.status,
        PantryMatchStatus.missing,
      );
    });

    test('a genuinely unrecognised outcome falls to noGroundedSuggestions, the conservative reading', () async {
      final s = _subject(
        (Request request) => _body('a_future_outcome', vibe: 'quick'),
      );
      final CookFromPantryResult result = await s.repository.cookFromPantry(
        householdId: _householdId,
        vibe: CookVibe.quick,
      );
      expect(result.outcome, CookOutcome.noGroundedSuggestions);
    });

    test('a genuinely unrecognised vibe echoed back falls to null ("any vibe") rather than crashing', () async {
      final s = _subject(
        (Request request) => _body(
          'suggestions',
          vibe: 'a_future_vibe',
          suggestions: <Map<String, dynamic>>[_suggestion()],
        ),
      );
      final CookFromPantryResult result = await s.repository.cookFromPantry(
        householdId: _householdId,
        vibe: CookVibe.quick,
      );
      expect(result.vibe, isNull);
    });

    test('surfaces a typed AppError for RATE_LIMITED/AI_* failures', () async {
      final s = _subject(
        (Request request) => _errorBody(
          'RATE_LIMITED',
          "You've asked for ideas 10 times today — that's the daily limit.",
        ),
      );
      await expectLater(
        s.repository.cookFromPantry(
          householdId: _householdId,
          vibe: CookVibe.quick,
        ),
        throwsA(isA<RateLimitedError>()),
      );
    });
  });
}
