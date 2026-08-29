import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/ai_recipe_draft.dart';

/// Drives `FreeformInputScreen`'s (W7 S10) submit — a one-shot
/// `parseFreeformRecipe` call, no local editing state of its own (that's
/// `AiRecipeDraftController`'s job once the draft reaches the review
/// screen). `autoDispose`, same reasoning as `RecipeFormController`: a
/// failed parse's error must not still be sitting in `state` the moment a
/// second push of this route opens.
class FreeformParseController extends AutoDisposeAsyncNotifier<AiRecipeDraft?> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  @override
  Future<AiRecipeDraft?> build() async => null;

  /// Never throws — errors land in `state.error`, matching
  /// `RecipeFormController`'s contract. Returns the parsed draft on
  /// success so the caller can navigate immediately without a second
  /// `ref.read`.
  Future<AiRecipeDraft?> parse(String text) async {
    state = const AsyncLoading<AiRecipeDraft?>();
    state = await AsyncValue.guard<AiRecipeDraft?>(
      () => _repository.parseFreeformRecipe(text),
    );
    return state.valueOrNull;
  }
}

final AutoDisposeAsyncNotifierProvider<FreeformParseController, AiRecipeDraft?>
freeformParseControllerProvider =
    AsyncNotifierProvider.autoDispose<FreeformParseController, AiRecipeDraft?>(
      FreeformParseController.new,
    );
