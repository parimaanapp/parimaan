import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/data/cook_repository.dart';
import 'package:mobile/features/cook/domain/cook_suggestion.dart';
import 'package:mobile/features/cook/domain/cook_vibe.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/cook/state/cook_suggestions_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

CookSuggestion _suggestion(String id) => CookSuggestion(
  id: id,
  draft: const AiRecipeDraft(title: 'Aloo Jeera'),
  ingredientMatches: const <CookIngredientMatch>[],
  have: const <String>['Potato'],
  missing: const <String>[],
);

class _FakeCookRepository implements CookRepository {
  final List<({String householdId, CookVibe? vibe})> calls =
      <({String householdId, CookVibe? vibe})>[];
  final List<Object> _outcomes = <Object>[];

  void succeedWith(CookFromPantryResult result) => _outcomes.add(result);
  void failWith(Object error) => _outcomes.add(_Failure(error));

  @override
  Future<CookFromPantryResult> cookFromPantry({
    required String householdId,
    required CookVibe? vibe,
  }) async {
    calls.add((householdId: householdId, vibe: vibe));
    if (_outcomes.isEmpty) {
      throw StateError('no scripted outcome');
    }
    final Object next = _outcomes.removeAt(0);
    if (next is _Failure) throw next.error;
    return next as CookFromPantryResult;
  }
}

class _Failure {
  const _Failure(this.error);
  final Object error;
}

({ProviderContainer container, _FakeCookRepository repository}) _subject() {
  final _FakeCookRepository repository = _FakeCookRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[cookRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  container.listen(cookSuggestionsControllerProvider('household-1'), (_, _) {});
  return (container: container, repository: repository);
}

void main() {
  test('starts idle', () {
    final s = _subject();
    expect(
      s.container.read(cookSuggestionsControllerProvider('household-1')),
      isA<CookSuggestionsIdle>(),
    );
  });

  test('requesting walks idle -> loading -> ready with the result', () async {
    final s = _subject();
    s.repository.succeedWith(
      CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        vibe: CookVibe.quick,
        suggestions: <CookSuggestion>[_suggestion('a')],
      ),
    );

    final future = s.container
        .read(cookSuggestionsControllerProvider('household-1').notifier)
        .request(CookVibe.quick);
    expect(
      s.container.read(cookSuggestionsControllerProvider('household-1')),
      isA<CookSuggestionsLoading>(),
    );
    await future;

    final state = s.container.read(
      cookSuggestionsControllerProvider('household-1'),
    );
    expect(state, isA<CookSuggestionsReady>());
    expect((state as CookSuggestionsReady).result.suggestions.single.id, 'a');
    expect(s.repository.calls.single, (
      householdId: 'household-1',
      vibe: CookVibe.quick,
    ));
  });

  test('a pantry_too_small or no_grounded_suggestions outcome lands on its own state, not Ready with an empty list', () async {
    final s = _subject();
    s.repository.succeedWith(
      CookFromPantryResult(outcome: CookOutcome.pantryTooSmall),
    );
    await s.container
        .read(cookSuggestionsControllerProvider('household-1').notifier)
        .request(null);
    expect(
      s.container.read(cookSuggestionsControllerProvider('household-1')),
      isA<CookSuggestionsPantryTooSmall>(),
    );

    s.repository.succeedWith(
      CookFromPantryResult(
        outcome: CookOutcome.noGroundedSuggestions,
        vibe: CookVibe.comfort,
      ),
    );
    await s.container
        .read(cookSuggestionsControllerProvider('household-1').notifier)
        .request(CookVibe.comfort);
    final state = s.container.read(
      cookSuggestionsControllerProvider('household-1'),
    );
    expect(state, isA<CookSuggestionsNoGrounded>());
    expect((state as CookSuggestionsNoGrounded).vibe, CookVibe.comfort);
  });

  test('a double request while loading is ignored, so it cannot spend two of the daily quota', () async {
    final s = _subject();
    s.repository.succeedWith(
      CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        suggestions: <CookSuggestion>[_suggestion('a')],
      ),
    );
    s.repository.succeedWith(
      CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        suggestions: <CookSuggestion>[_suggestion('b')],
      ),
    );

    final notifier = s.container.read(
      cookSuggestionsControllerProvider('household-1').notifier,
    );
    final first = notifier.request(CookVibe.quick);
    final second = notifier.request(CookVibe.weekend);
    await Future.wait(<Future<void>>[first, second]);

    expect(s.repository.calls, hasLength(1));
  });

  test(
    'a failure is typed, with canRetry narrow to the retryable AppErrors',
    () async {
      final s = _subject();
      s.repository.failWith(const AiTimeoutError('slow'));
      await s.container
          .read(cookSuggestionsControllerProvider('household-1').notifier)
          .request(CookVibe.quick);
      final state = s.container.read(
        cookSuggestionsControllerProvider('household-1'),
      );
      expect(state, isA<CookSuggestionsFailed>());
      expect((state as CookSuggestionsFailed).canRetry, isTrue);

      s.repository.failWith(const RateLimitedError('limit'));
      await s.container
          .read(cookSuggestionsControllerProvider('household-1').notifier)
          .request(CookVibe.quick);
      final state2 = s.container.read(
        cookSuggestionsControllerProvider('household-1'),
      ) as CookSuggestionsFailed;
      expect(state2.canRetry, isFalse);
    },
  );

  test('a new request after Ready or Failed DOES re-fetch (e.g. "change vibe"), unlike the in-flight guard', () async {
    final s = _subject();
    s.repository.succeedWith(
      CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        vibe: CookVibe.quick,
        suggestions: <CookSuggestion>[_suggestion('a')],
      ),
    );
    s.repository.succeedWith(
      CookFromPantryResult(
        outcome: CookOutcome.suggestions,
        vibe: CookVibe.weekend,
        suggestions: <CookSuggestion>[_suggestion('b')],
      ),
    );

    final notifier = s.container.read(
      cookSuggestionsControllerProvider('household-1').notifier,
    );
    await notifier.request(CookVibe.quick);
    await notifier.request(CookVibe.weekend);

    expect(s.repository.calls, hasLength(2));
    final state = s.container.read(
      cookSuggestionsControllerProvider('household-1'),
    ) as CookSuggestionsReady;
    expect(state.result.vibe, CookVibe.weekend);
  });

  test('reset returns to idle', () async {
    final s = _subject();
    s.repository.succeedWith(
      CookFromPantryResult(outcome: CookOutcome.pantryTooSmall),
    );
    final notifier = s.container.read(
      cookSuggestionsControllerProvider('household-1').notifier,
    );
    await notifier.request(null);
    notifier.reset();
    expect(
      s.container.read(cookSuggestionsControllerProvider('household-1')),
      isA<CookSuggestionsIdle>(),
    );
  });
}
