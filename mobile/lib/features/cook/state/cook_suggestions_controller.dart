import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../data/cook_repository.dart';
import '../domain/cook_suggestion.dart';
import '../domain/cook_vibe.dart';

/// Where one "what can I cook?" request is, keyed by household (W21 S4).
sealed class CookSuggestionsState {
  const CookSuggestionsState();
}

final class CookSuggestionsIdle extends CookSuggestionsState {
  const CookSuggestionsIdle();
}

final class CookSuggestionsLoading extends CookSuggestionsState {
  const CookSuggestionsLoading();
}

final class CookSuggestionsReady extends CookSuggestionsState {
  const CookSuggestionsReady(this.result);
  final CookFromPantryResult result;
}

final class CookSuggestionsPantryTooSmall extends CookSuggestionsState {
  const CookSuggestionsPantryTooSmall();
}

final class CookSuggestionsNoGrounded extends CookSuggestionsState {
  const CookSuggestionsNoGrounded(this.vibe);
  final CookVibe? vibe;
}

final class CookSuggestionsFailed extends CookSuggestionsState {
  const CookSuggestionsFailed(this.error);
  final AppError error;

  /// Narrow, matching the photo-analysis controller's own rule: a daily-limit
  /// hit or an answer the model cannot produce is not fixed by a retry.
  bool get canRetry => switch (error) {
    AiTimeoutError() ||
    AiBusyError() ||
    NotFoundError() ||
    InternalError() => true,
    _ => false,
  };
}

/// Non-autoDispose: a result should survive the trip from the trigger screen
/// to the suggestions list and back, the same reasoning as
/// `PhotoReviewSessionController` (W20 S6).
class CookSuggestionsController
    extends FamilyNotifier<CookSuggestionsState, String> {
  CookVibe? _lastVibe;

  @override
  CookSuggestionsState build(String householdId) => const CookSuggestionsIdle();

  CookRepository get _repository => ref.read(cookRepositoryProvider);

  /// Ignored while a request is already in flight, so a double tap cannot
  /// spend two of the day's 10 requests. Calling this again from [CookSuggestionsReady]
  /// or [CookSuggestionsFailed] — e.g. "change vibe" — DOES re-fetch and spend another
  /// request; only a request already in flight is guarded against.
  Future<void> request(CookVibe? vibe) async {
    if (state is CookSuggestionsLoading) {
      return;
    }
    _lastVibe = vibe;
    state = const CookSuggestionsLoading();
    try {
      final CookFromPantryResult result = await _repository.cookFromPantry(
        householdId: arg,
        vibe: vibe,
      );
      state = switch (result.outcome) {
        CookOutcome.suggestions => CookSuggestionsReady(result),
        CookOutcome.pantryTooSmall => const CookSuggestionsPantryTooSmall(),
        CookOutcome.noGroundedSuggestions => CookSuggestionsNoGrounded(
          result.vibe,
        ),
      };
    } on AppError catch (error) {
      state = CookSuggestionsFailed(error);
    }
  }

  /// Re-runs the last request, when a retry can help.
  Future<void> retry() async {
    final CookSuggestionsState current = state;
    if (current is! CookSuggestionsFailed || !current.canRetry) {
      return;
    }
    await request(_lastVibe);
  }

  void reset() => state = const CookSuggestionsIdle();
}

final NotifierProviderFamily<
  CookSuggestionsController,
  CookSuggestionsState,
  String
>
cookSuggestionsControllerProvider =
    NotifierProvider.family<
      CookSuggestionsController,
      CookSuggestionsState,
      String
    >(CookSuggestionsController.new);
