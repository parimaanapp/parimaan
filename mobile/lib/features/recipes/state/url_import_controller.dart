import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/ai_recipe_draft.dart';

/// Drives `UrlImportScreen`'s (W7 S9) submit — a one-shot
/// `importRecipeFromUrl` call, same shape as `FreeformParseController`
/// (W7 S10). `autoDispose`, same reasoning: a failed import's error must
/// not still be sitting in `state` the moment a second push of this route
/// opens.
class UrlImportController extends AutoDisposeAsyncNotifier<AiRecipeDraft?> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  @override
  Future<AiRecipeDraft?> build() async => null;

  /// Never throws — errors land in `state.error`, matching
  /// `FreeformParseController`'s contract. Returns the parsed draft on
  /// success so the caller can navigate immediately without a second
  /// `ref.read`.
  Future<AiRecipeDraft?> import(String url) async {
    state = const AsyncLoading<AiRecipeDraft?>();
    state = await AsyncValue.guard<AiRecipeDraft?>(
      () => _repository.importRecipeFromUrl(url),
    );
    return state.valueOrNull;
  }
}

final AutoDisposeAsyncNotifierProvider<UrlImportController, AiRecipeDraft?>
urlImportControllerProvider =
    AsyncNotifierProvider.autoDispose<UrlImportController, AiRecipeDraft?>(
      UrlImportController.new,
    );
