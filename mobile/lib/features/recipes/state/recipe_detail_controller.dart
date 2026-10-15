import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/recipe.dart';

/// The server-backed read of one recipe, keyed by `(householdId, id)` —
/// `householdId` travels alongside `id` purely so this controller can
/// subscribe to `watchRecipeChanges(householdId)` without a network round
/// trip to learn it first; the read itself (`fetchRecipeDetail`) is
/// `id`-only, matching `Query.recipe`'s own SDL.
typedef RecipeDetailArg = ({String householdId, String id});

/// Same *family* reasoning as `PantryController`/`RecipeLibraryController`:
/// two different recipes' Detail screens must not share one cached slot.
///
/// Read-only — the Overflow menu's favorite/rotation/delete actions live in
/// the separate `RecipeOverflowController`, matching this codebase's
/// established split (`PantryController`/`PantryFormController`,
/// `CurrentHouseholdController`/`HouseholdSettingsController`): an action
/// failure must never blank the already-loaded recipe behind an error
/// screen the way reusing this controller's own `AsyncValue<Recipe>` for
/// action errors would.
class RecipeDetailController
    extends FamilyAsyncNotifier<Recipe, RecipeDetailArg> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  /// Nullable, not `late final` — same `build()`-can-rerun reasoning as
  /// `PantryController._changeSubscription`.
  StreamSubscription<void>? _changeSubscription;

  @override
  Future<Recipe> build(RecipeDetailArg arg) {
    unawaited(_changeSubscription?.cancel());
    _changeSubscription = _repository
        .watchRecipeChanges(arg.householdId)
        .listen((_) => unawaited(_refetch()), onError: (Object _) {});
    ref.onDispose(() => unawaited(_changeSubscription?.cancel()));

    return _repository.fetchRecipeDetail(arg.id);
  }

  /// Same `copyWithPrevious` shape as `PantryController._refetch`: a failed
  /// refetch (a live-update push whose follow-up read then fails) keeps the
  /// last good recipe on screen rather than blanking it.
  Future<void> _refetch() async {
    final AsyncValue<Recipe> previous = state;
    state = const AsyncLoading<Recipe>().copyWithPrevious(previous);

    final AsyncValue<Recipe> result = await AsyncValue.guard<Recipe>(
      () => _repository.fetchRecipeDetail(arg.id),
    );

    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }

  /// Pushes [recipe] straight into `state` — called by
  /// `RecipeOverflowController` after a successful favorite/rotation
  /// mutation, which already returns the whole updated `Recipe` (the
  /// `HouseholdSettingsController.rotateInviteCode` pattern: the mutation
  /// response already has everything this controller would otherwise
  /// re-fetch, so use it instead of a second round trip). Not "optimistic"
  /// — this runs only after the server has confirmed the change.
  void applyUpdatedRecipe(Recipe recipe) {
    state = AsyncData<Recipe>(recipe);
  }
}

final AsyncNotifierProviderFamily<RecipeDetailController, Recipe, RecipeDetailArg>
recipeDetailControllerProvider =
    AsyncNotifierProvider.family<RecipeDetailController, Recipe, RecipeDetailArg>(
      RecipeDetailController.new,
    );
