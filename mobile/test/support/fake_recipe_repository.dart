import 'dart:async';

import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_draft.dart';
import 'package:mobile/features/recipes/domain/recipe_patch.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source_attribution.dart';

/// Hand-written [RecipeRepository] double — same rationale as
/// `fake_pantry_repository.dart`: explicit control over completion timing
/// (the loading-state requirement) that a `mocktail` stub makes awkward,
/// plus a call log so a test can assert exactly which filters were sent.
class FakeRecipeRepository implements RecipeRepository {
  FakeRecipeRepository({
    this.result,
    this.error,
    this.delay,
    this.detailResult,
    this.detailError,
    this.favoriteResult,
    this.favoriteError,
    this.setInRotationResult,
    this.setInRotationError,
    this.deleteResult,
    this.deleteError,
    this.createResult,
    this.createError,
    this.updateResult,
    this.updateError,
  });

  List<Recipe>? result;
  Object? error;

  /// Artificial latency applied to every call, for asserting the loading
  /// state.
  Duration? delay;

  /// Every `(householdId, role, isFavorite, inRotation)` quadruple, in order.
  final List<({String householdId, RecipeRole? role, bool? isFavorite, bool? inRotation})>
  calls = <({String householdId, RecipeRole? role, bool? isFavorite, bool? inRotation})>[];

  @override
  Future<List<Recipe>> fetchRecipes(
    String householdId, {
    RecipeRole? role,
    bool? isFavorite,
    bool? inRotation,
  }) async {
    calls.add((
      householdId: householdId,
      role: role,
      isFavorite: isFavorite,
      inRotation: inRotation,
    ));
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
    final Object? error = this.error;
    if (error != null) {
      throw error;
    }
    final List<Recipe>? result = this.result;
    if (result == null) {
      throw StateError('FakeRecipeRepository needs a `result` or an error.');
    }
    return result;
  }

  // ── watchRecipeChanges ─────────────────────────────────────────────────

  /// One controller per `householdId` a test has called
  /// [watchRecipeChanges] for, so a test can `.add(null)`/`.addError(...)`
  /// to simulate a live-update push without any real subscription
  /// transport. Never emits on its own — a test opts in explicitly. Same
  /// shape as `FakePantryRepository.watchControllers`.
  final Map<String, StreamController<void>> watchControllers =
      <String, StreamController<void>>{};

  /// Every `householdId` [watchRecipeChanges] was called with, in order —
  /// asserts a controller's `build()` actually subscribed.
  final List<String> watchCalls = <String>[];

  @override
  Stream<void> watchRecipeChanges(String householdId) {
    watchCalls.add(householdId);
    return watchControllers
        .putIfAbsent(householdId, () => StreamController<void>.broadcast())
        .stream;
  }

  // ── fetchRecipeDetail ──────────────────────────────────────────────────

  Recipe? detailResult;
  Object? detailError;
  final List<String> detailCalls = <String>[];

  @override
  Future<Recipe> fetchRecipeDetail(String id) {
    detailCalls.add(id);
    return _answer<Recipe>(detailError, detailResult, 'detailResult');
  }

  // ── favoriteRecipe ─────────────────────────────────────────────────────

  Recipe? favoriteResult;
  Object? favoriteError;
  final List<({String id, bool favorite})> favoriteCalls =
      <({String id, bool favorite})>[];

  @override
  Future<Recipe> favoriteRecipe(String id, bool favorite) {
    favoriteCalls.add((id: id, favorite: favorite));
    return _answer<Recipe>(favoriteError, favoriteResult, 'favoriteResult');
  }

  // ── setInRotation ──────────────────────────────────────────────────────

  Recipe? setInRotationResult;
  Object? setInRotationError;
  final List<({String id, bool inRotation})> setInRotationCalls =
      <({String id, bool inRotation})>[];

  @override
  Future<Recipe> setInRotation(String id, bool inRotation) {
    setInRotationCalls.add((id: id, inRotation: inRotation));
    return _answer<Recipe>(
      setInRotationError,
      setInRotationResult,
      'setInRotationResult',
    );
  }

  // ── deleteRecipe ───────────────────────────────────────────────────────

  Recipe? deleteResult;
  Object? deleteError;
  final List<String> deleteCalls = <String>[];

  @override
  Future<Recipe> deleteRecipe(String id) {
    deleteCalls.add(id);
    return _answer<Recipe>(deleteError, deleteResult, 'deleteResult');
  }

  // ── createRecipe ───────────────────────────────────────────────────────

  Recipe? createResult;
  Object? createError;
  final List<({String householdId, RecipeDraft draft, RecipeSourceAttribution? source})>
  createCalls =
      <({String householdId, RecipeDraft draft, RecipeSourceAttribution? source})>[];

  @override
  Future<Recipe> createRecipe(
    String householdId,
    RecipeDraft draft, {
    RecipeSourceAttribution? source,
  }) {
    createCalls.add((householdId: householdId, draft: draft, source: source));
    return _answer<Recipe>(createError, createResult, 'createResult');
  }

  // ── updateRecipe ───────────────────────────────────────────────────────

  Recipe? updateResult;
  Object? updateError;
  final List<({String id, RecipePatch patch})> updateCalls =
      <({String id, RecipePatch patch})>[];

  @override
  Future<Recipe> updateRecipe(String id, RecipePatch patch) {
    updateCalls.add((id: id, patch: patch));
    return _answer<Recipe>(updateError, updateResult, 'updateResult');
  }

  // ── parseFreeformRecipe ────────────────────────────────────────────────

  AiRecipeDraft? parseFreeformRecipeResult;
  Object? parseFreeformRecipeError;
  final List<String> parseFreeformRecipeCalls = <String>[];

  @override
  Future<AiRecipeDraft> parseFreeformRecipe(String text) {
    parseFreeformRecipeCalls.add(text);
    return _answer<AiRecipeDraft>(
      parseFreeformRecipeError,
      parseFreeformRecipeResult,
      'parseFreeformRecipeResult',
    );
  }

  // ── importRecipeFromUrl ────────────────────────────────────────────────

  AiRecipeDraft? importRecipeFromUrlResult;
  Object? importRecipeFromUrlError;
  final List<String> importRecipeFromUrlCalls = <String>[];

  @override
  Future<AiRecipeDraft> importRecipeFromUrl(String url) {
    importRecipeFromUrlCalls.add(url);
    return _answer<AiRecipeDraft>(
      importRecipeFromUrlError,
      importRecipeFromUrlResult,
      'importRecipeFromUrlResult',
    );
  }

  Future<T> _answer<T>(Object? error, T? value, String field) async {
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
    if (error != null) {
      throw error;
    }
    if (value == null) {
      throw StateError('FakeRecipeRepository needs a `$field` or an error.');
    }
    return value;
  }
}
