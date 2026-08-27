import 'dart:async';

import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';

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
  });

  List<Recipe>? result;
  Object? error;

  /// Artificial latency applied to every call, for asserting the loading
  /// state.
  Duration? delay;

  /// Every `(householdId, role, isFavorite)` triple, in order.
  final List<({String householdId, RecipeRole? role, bool? isFavorite})>
  calls = <({String householdId, RecipeRole? role, bool? isFavorite})>[];

  @override
  Future<List<Recipe>> fetchRecipes(
    String householdId, {
    RecipeRole? role,
    bool? isFavorite,
  }) async {
    calls.add((householdId: householdId, role: role, isFavorite: isFavorite));
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
