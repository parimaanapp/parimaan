import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../recipes/data/recipe_repository.dart';
import '../../recipes/domain/recipe.dart';
import '../../recipes/domain/recipe_role.dart';

/// The compound key [RecipePickerController] is keyed on — a household id
/// alone isn't enough (a picker sheet is always opened for one specific
/// slot's role), same reasoning `CurrentMenuController`'s own `MenuKey`
/// gives for its own compound key.
typedef RecipePickerKey = ({String householdId, RecipeRole slotRole});

/// The server-backed, role-filtered read behind the recipe picker sheet
/// (W10 S5, E2E_MVP_PLAN.md §16.3) — a one-shot fetch, deliberately
/// simpler than `RecipeLibraryController`: no live-update subscription (a
/// picker is a short-lived sheet, not a persistent screen a background push
/// needs to keep fresh) and no mutable filter state (the role is fixed for
/// the lifetime of one picker open — a different slot means a different
/// [RecipePickerKey], not a filter change on this one).
///
/// Ordering (favorites, then rotation, then title) is entirely server-side
/// (`Query.recipes`' own `ORDER BY`, W10 §16.2.5) — this controller applies
/// no client-side sort of its own.
class RecipePickerController extends FamilyAsyncNotifier<List<Recipe>, RecipePickerKey> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  @override
  Future<List<Recipe>> build(RecipePickerKey key) =>
      _repository.fetchRecipes(key.householdId, role: key.slotRole);
}

final AsyncNotifierProviderFamily<RecipePickerController, List<Recipe>, RecipePickerKey>
recipePickerControllerProvider =
    AsyncNotifierProvider.family<RecipePickerController, List<Recipe>, RecipePickerKey>(
      RecipePickerController.new,
    );
