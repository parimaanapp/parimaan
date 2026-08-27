import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/recipe_draft.dart';
import '../domain/recipe_patch.dart';
import 'recipe_detail_controller.dart';
import 'recipe_library_controller.dart';

/// Which form action last ran, so a caller could distinguish create from
/// update if it ever needed to — same reasoning as `PantryFormAction`.
enum RecipeFormAction { none, create, update }

/// Create and edit for `RecipeFormScreen` — one screen for both jobs (W6
/// S8, §11.2.7's seeded-form reuse pattern, matching `ManualAddScreen`'s
/// precedent).
///
/// **`autoDispose`, not a bare singleton** — a plain `AsyncNotifierProvider`
/// (`PantryFormController`'s own shape) would let a failed create's error
/// on one screen instance still be sitting in `state` the moment a *second*
/// push of this same route opens (e.g. cancel out of a failed create, edit
/// a different recipe next) — the screen renders `formState.error`
/// immediately on build, before any submit, so that stale error would flash
/// on a form the user hasn't touched yet. `autoDispose` clears state once
/// nothing is watching (the screen pops), so the next push starts clean.
/// This is the same leak class `flutter-reviewer` caught in
/// `RecipeOverflowController` (W6 S7) — applied here proactively rather
/// than waiting to be told twice.
///
/// Every method **never throws** and returns `true` only on success,
/// matching `PantryFormController`'s contract.
class RecipeFormController extends AutoDisposeAsyncNotifier<void> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  RecipeFormAction get action => _action;
  RecipeFormAction _action = RecipeFormAction.none;

  @override
  Future<void> build() async {}

  Future<bool> create(String householdId, RecipeDraft draft) =>
      _run(RecipeFormAction.create, () async {
        await _repository.createRecipe(householdId, draft);
        ref.invalidate(recipeLibraryControllerProvider(householdId));
      });

  /// Named `updateRecipe`, not `update` — `AsyncNotifierBase` already
  /// declares a built-in `update` (a `state`-transform helper), and this
  /// method's unrelated signature can't override it, the same naming
  /// collision `PantryFormController.updateItem` avoids.
  ///
  /// [arg] is the recipe being edited — its own Detail screen (and the
  /// Library) are invalidated on success so both reflect the edit without
  /// an optimistic patch (matching S7's own "no optimistic update" call).
  Future<bool> updateRecipe(RecipeDetailArg arg, RecipePatch patch) =>
      _run(RecipeFormAction.update, () async {
        await _repository.updateRecipe(arg.id, patch);
        ref.invalidate(recipeLibraryControllerProvider(arg.householdId));
        ref.invalidate(recipeDetailControllerProvider(arg));
      });

  /// The one place both actions share: mark which action is running, park
  /// the outcome, report success. Identical shape to
  /// `PantryFormController._run`.
  Future<bool> _run(
    RecipeFormAction action,
    Future<void> Function() body,
  ) async {
    _action = action;
    state = const AsyncLoading<void>();
    state = await AsyncValue.guard<void>(body);
    return !state.hasError;
  }
}

final AutoDisposeAsyncNotifierProvider<RecipeFormController, void>
recipeFormControllerProvider =
    AsyncNotifierProvider.autoDispose<RecipeFormController, void>(
      RecipeFormController.new,
    );
