import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/recipe.dart';
import 'recipe_detail_controller.dart';
import 'recipe_library_controller.dart';

/// Which Overflow menu action last ran, so the menu can put a spinner on
/// the right item — same reasoning as `HouseholdSettingsAction`.
enum RecipeOverflowAction { none, favorite, rotation, delete }

/// The Detail screen's Overflow menu: toggle favorite, toggle rotation,
/// delete (W6 S7). One controller per recipe for the same "mutually
/// exclusive by intent, one in-flight action" reasoning as
/// `PantryFormController`/`HouseholdSettingsController` — there is no flow
/// where a favorite toggle and a delete are in flight together on the same
/// recipe.
///
/// **`autoDispose.family`, not a bare singleton** — unlike
/// `PantryFormController`/`HouseholdSettingsController` (each effectively
/// scoped to a single screen for the app's whole session), this controller
/// is invoked per recipe. A bare singleton would let a failed toggle's
/// error on recipe A leak into recipe B's Overflow menu the next time it
/// opens — nothing else would ever reset `state`/[action] between recipes.
/// `family<RecipeDetailArg>` scopes state per recipe; `autoDispose` clears
/// it once nothing is watching (the sheet/dialog closes), so even the
/// *same* recipe gets a clean slate on the next open rather than replaying
/// a stale error from an earlier visit.
///
/// No optimistic update (E2E_MVP_PLAN.md §12.3 S7): [setFavorite]/
/// [setInRotation] push the mutation's own returned `Recipe` straight into
/// `RecipeDetailController.applyUpdatedRecipe` only *after* the server
/// confirms it, and invalidate `RecipeLibraryController` for the same
/// household so the Library re-syncs its own (unrelated, non-`ingredients`)
/// cached list — the `PantryFormController.updateItem`-cites-invalidate
/// pattern S7's own plan text names. [delete] only invalidates the
/// Library; the Detail screen itself is expected to pop on success, so
/// there is nothing left to update here.
///
/// Every method **never throws** and returns `true` only on success,
/// matching `PantryFormController`'s contract — the concrete `AppError`
/// subtype lands in `state.error` for the Overflow menu to render, without
/// ever touching `RecipeDetailController`'s own `AsyncValue<Recipe>` (a
/// failed toggle must not blank the recipe already on screen).
class RecipeOverflowController
    extends AutoDisposeFamilyAsyncNotifier<void, RecipeDetailArg> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  RecipeOverflowAction get action => _action;
  RecipeOverflowAction _action = RecipeOverflowAction.none;

  /// Tracked manually, not via `ref.mounted` — this pinned riverpod version
  /// (2.6.1) has `mounted` on the internal provider *element*, not on the
  /// `Ref` a notifier's own methods see, so there is no built-in post-
  /// dispose check available here. `autoDispose`: nothing stops the sheet
  /// that started a mutation from closing (and so this controller from
  /// being torn down) while the request is still in flight — a closed-but-
  /// still-awaiting case `PantryFormController`'s bare-singleton precedent
  /// never had to guard against. Every post-`await` `ref`/`state` use in
  /// this class checks [_disposed] first, defense-in-depth against touching
  /// either post-disposal — see the test suite's own note on why this
  /// wasn't reproducible as an actual crash against this pinned riverpod
  /// version specifically, which is not a property to rely on staying true.
  bool _disposed = false;

  @override
  Future<void> build(RecipeDetailArg arg) async {
    ref.onDispose(() => _disposed = true);
  }

  Future<bool> setFavorite(bool favorite) =>
      _run(RecipeOverflowAction.favorite, () async {
        final Recipe updated = await _repository.favoriteRecipe(arg.id, favorite);
        if (_disposed) {
          return;
        }
        ref.read(recipeDetailControllerProvider(arg).notifier).applyUpdatedRecipe(updated);
        ref.invalidate(recipeLibraryControllerProvider(arg.householdId));
      });

  Future<bool> setInRotation(bool inRotation) =>
      _run(RecipeOverflowAction.rotation, () async {
        final Recipe updated = await _repository.setInRotation(arg.id, inRotation);
        if (_disposed) {
          return;
        }
        ref.read(recipeDetailControllerProvider(arg).notifier).applyUpdatedRecipe(updated);
        ref.invalidate(recipeLibraryControllerProvider(arg.householdId));
      });

  Future<bool> delete() => _run(RecipeOverflowAction.delete, () async {
    await _repository.deleteRecipe(arg.id);
    if (_disposed) {
      return;
    }
    ref.invalidate(recipeLibraryControllerProvider(arg.householdId));
  });

  /// The one place the three actions share: mark which action is running,
  /// park the outcome, report success. Identical shape to
  /// `HouseholdSettingsController._run`, plus the [_disposed] guard
  /// `autoDispose` requires (see this class's own doc): `state =` after the
  /// `await` is itself a post-dispose touch if this controller was torn
  /// down while `body` was running.
  Future<bool> _run(
    RecipeOverflowAction action,
    Future<void> Function() body,
  ) async {
    _action = action;
    state = const AsyncLoading<void>();
    final AsyncValue<void> result = await AsyncValue.guard<void>(body);
    state = result;
    return !state.hasError;
  }
}

final AutoDisposeAsyncNotifierProviderFamily<RecipeOverflowController, void, RecipeDetailArg>
recipeOverflowControllerProvider =
    AsyncNotifierProvider.autoDispose.family<RecipeOverflowController, void, RecipeDetailArg>(
      RecipeOverflowController.new,
    );
