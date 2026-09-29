import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/data/cook_repository.dart';
import 'package:mobile/features/cook/domain/cook_suggestion.dart';
import 'package:mobile/features/cook/domain/cook_vibe.dart';
import 'package:mobile/features/cook/presentation/cook_suggestions_screen.dart';
import 'package:mobile/features/cook/state/cook_suggestions_controller.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

const String _householdId = 'household-1';

class _FakeCookRepository implements CookRepository {
  final List<Object> _outcomes = <Object>[];
  void succeedWith(CookFromPantryResult result) => _outcomes.add(result);
  void failWith(Object error) => _outcomes.add(_Failure(error));

  @override
  Future<CookFromPantryResult> cookFromPantry({
    required String householdId,
    required CookVibe? vibe,
  }) async {
    if (_outcomes.isEmpty) throw StateError('no scripted outcome');
    final Object next = _outcomes.removeAt(0);
    if (next is _Failure) throw next.error;
    return next as CookFromPantryResult;
  }
}

class _Failure {
  const _Failure(this.error);
  final Object error;
}

CookSuggestion _suggestion(
  String id,
  String title, {
  List<String> have = const <String>['Potato'],
  List<String> missing = const <String>['coriander'],
}) => CookSuggestion(
  id: id,
  draft: AiRecipeDraft(title: title),
  ingredientMatches: const <CookIngredientMatch>[],
  have: have,
  missing: missing,
);

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required _FakeCookRepository repository,
  CookVibe? requestVibe = CookVibe.quick,
  bool triggerRequest = true,
  bool settle = true,
  ValueChanged<CookSuggestion>? onSelect,
  VoidCallback? onDeadEndAction,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[cookRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  if (triggerRequest) {
    unawaited(
      container
          .read(cookSuggestionsControllerProvider(_householdId).notifier)
          .request(requestVibe),
    );
  }
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: CookSuggestionsScreen(
          householdId: _householdId,
          onSelectSuggestion: onSelect ?? (_) {},
          onDifferentVibe: () => onDeadEndAction?.call(),
          onAddManually: () => onDeadEndAction?.call(),
        ),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
  return container;
}

Future<void> unawaited(Future<void> f) async {}

void main() {
  group('CookSuggestionsScreen', () {
    testWidgets(
      'shows a loading state, then the grounded badge and each suggestion\'s Have/Missing',
      (WidgetTester tester) async {
        final repo = _FakeCookRepository();
        repo.succeedWith(
          CookFromPantryResult(
            outcome: CookOutcome.suggestions,
            vibe: CookVibe.quick,
            suggestions: <CookSuggestion>[
              _suggestion(
                'a',
                'Aloo Jeera',
                have: <String>['Potato', 'Jeera'],
                missing: <String>['coriander'],
              ),
            ],
          ),
        );
        await _pump(tester, repository: repo);

        expect(find.textContaining('GROUNDED IN PANTRY'), findsOneWidget);
        expect(find.text('Aloo Jeera'), findsOneWidget);
        expect(find.textContaining('Potato'), findsOneWidget);
        expect(find.textContaining('coriander'), findsOneWidget);
      },
    );

    testWidgets('tapping a suggestion card calls onSelectSuggestion with it', (
      WidgetTester tester,
    ) async {
      final repo = _FakeCookRepository();
      final CookSuggestion suggestion = _suggestion('a', 'Aloo Jeera');
      repo.succeedWith(
        CookFromPantryResult(
          outcome: CookOutcome.suggestions,
          suggestions: <CookSuggestion>[suggestion],
        ),
      );
      CookSuggestion? selected;
      await _pump(
        tester,
        repository: repo,
        onSelect: (CookSuggestion s) => selected = s,
      );

      await tester.tap(find.text('Aloo Jeera'));
      await tester.pumpAndSettle();

      expect(selected?.id, 'a');
    });

    testWidgets(
      'renders 1-2 suggestions honestly without implying a missing third',
      (WidgetTester tester) async {
        final repo = _FakeCookRepository();
        repo.succeedWith(
          CookFromPantryResult(
            outcome: CookOutcome.suggestions,
            suggestions: <CookSuggestion>[_suggestion('a', 'Aloo Jeera')],
          ),
        );
        await _pump(tester, repository: repo);

        expect(find.text('Aloo Jeera'), findsOneWidget);
        expect(find.textContaining('Save any'), findsOneWidget);
      },
    );

    testWidgets(
      'a pantry-too-small outcome shows the dead end, not an empty list',
      (WidgetTester tester) async {
        final repo = _FakeCookRepository();
        repo.succeedWith(
          CookFromPantryResult(outcome: CookOutcome.pantryTooSmall),
        );
        await _pump(tester, repository: repo);

        expect(
          find.text("Your pantry's looking a little bare"),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'a no-grounded-suggestions outcome offers "try a different vibe" first',
      (WidgetTester tester) async {
        final repo = _FakeCookRepository();
        repo.succeedWith(
          CookFromPantryResult(
            outcome: CookOutcome.noGroundedSuggestions,
            vibe: CookVibe.quick,
          ),
        );
        int actions = 0;
        await _pump(tester, repository: repo, onDeadEndAction: () => actions++);

        expect(find.text('Try a different vibe'), findsOneWidget);
        await tester.tap(find.text('Try a different vibe'));
        await tester.pumpAndSettle();
        expect(actions, 1);
      },
    );

    testWidgets(
      'reaching the screen idle (no request was ever made — a deep link or restored route) recovers rather than spinning forever',
      (WidgetTester tester) async {
        final repo = _FakeCookRepository();
        int recovered = 0;
        await _pump(
          tester,
          repository: repo,
          triggerRequest: false,
          settle: false,
          onDeadEndAction: () => recovered++,
        );
        // Nothing was scripted and no request was ever made: the screen must not spin forever.
        expect(recovered, 1);
      },
    );

    testWidgets('a failure shows the dead end with retry when retryable', (
      WidgetTester tester,
    ) async {
      final repo = _FakeCookRepository();
      repo.failWith(const AiTimeoutError('slow'));
      await _pump(tester, repository: repo);

      expect(find.text('That took too long'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });
  });
}
