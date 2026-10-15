import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/ai_recipe_draft.dart';
import '../domain/ai_recipe_draft_ingredient.dart';
import '../domain/proposed_field.dart';
import '../domain/recipe_role.dart';

/// The reviewable, per-field state of one [AiRecipeDraft] — shared by both
/// review paths (S9's URL-import review, S10's freeform-paste review,
/// E2E_MVP_PLAN.md §13.3 S7), since neither cares which mutation produced
/// the draft it's reviewing. Every field the user can act on starts as a
/// [ProposedField.proposed] seeded straight from the draft; [sourceUrl]/
/// [warnings] are plain pass-through — there is nothing to accept, edit,
/// or reject about either.
class AiRecipeDraftState {
  const AiRecipeDraftState({
    required this.title,
    required this.description,
    required this.servings,
    required this.prepMin,
    required this.cookMin,
    required this.cuisineTier1,
    required this.cuisineTier2,
    required this.dietaryTags,
    required this.role,
    required this.ingredients,
    required this.steps,
    required this.sourceUrl,
    required this.warnings,
  });

  factory AiRecipeDraftState.fromDraft(AiRecipeDraft draft) => AiRecipeDraftState(
    title: ProposedField<String>.proposed(draft.title),
    description: ProposedField<String>.proposed(draft.description),
    servings: ProposedField<int>.proposed(draft.servings),
    prepMin: ProposedField<int>.proposed(draft.prepMin),
    cookMin: ProposedField<int>.proposed(draft.cookMin),
    cuisineTier1: ProposedField<String>.proposed(draft.cuisineTier1),
    cuisineTier2: ProposedField<String>.proposed(draft.cuisineTier2),
    dietaryTags: ProposedField<List<String>>.proposed(draft.dietaryTags),
    role: ProposedField<RecipeRole>.proposed(draft.role),
    ingredients: ProposedField<List<AiRecipeDraftIngredient>>.proposed(
      draft.ingredients,
    ),
    steps: ProposedField<List<String>>.proposed(draft.steps),
    sourceUrl: draft.sourceUrl,
    warnings: draft.warnings,
  );

  final ProposedField<String> title;
  final ProposedField<String> description;
  final ProposedField<int> servings;
  final ProposedField<int> prepMin;
  final ProposedField<int> cookMin;
  final ProposedField<String> cuisineTier1;
  final ProposedField<String> cuisineTier2;
  final ProposedField<List<String>> dietaryTags;
  final ProposedField<RecipeRole> role;
  final ProposedField<List<AiRecipeDraftIngredient>> ingredients;
  final ProposedField<List<String>> steps;
  final String? sourceUrl;
  final List<String> warnings;

  /// W6 D1's "role assignment required" still holds through the AI review
  /// path (§13.2.6 D5): a proposed-but-untouched role does not satisfy
  /// it — the user must affirmatively confirm or change it first, the same
  /// "no default anywhere" rule the blank structured form already enforces.
  bool get isRoleConfirmed => role.value != null && !role.isProposed;

  AiRecipeDraftState copyWith({
    ProposedField<String>? title,
    ProposedField<String>? description,
    ProposedField<int>? servings,
    ProposedField<int>? prepMin,
    ProposedField<int>? cookMin,
    ProposedField<String>? cuisineTier1,
    ProposedField<String>? cuisineTier2,
    ProposedField<List<String>>? dietaryTags,
    ProposedField<RecipeRole>? role,
    ProposedField<List<AiRecipeDraftIngredient>>? ingredients,
    ProposedField<List<String>>? steps,
  }) => AiRecipeDraftState(
    title: title ?? this.title,
    description: description ?? this.description,
    servings: servings ?? this.servings,
    prepMin: prepMin ?? this.prepMin,
    cookMin: cookMin ?? this.cookMin,
    cuisineTier1: cuisineTier1 ?? this.cuisineTier1,
    cuisineTier2: cuisineTier2 ?? this.cuisineTier2,
    dietaryTags: dietaryTags ?? this.dietaryTags,
    role: role ?? this.role,
    ingredients: ingredients ?? this.ingredients,
    steps: steps ?? this.steps,
    sourceUrl: sourceUrl,
    warnings: warnings,
  );
}

/// Local, synchronous editing state for one [AiRecipeDraft] review — no
/// network I/O of its own; S9/S10 each fetch the draft via their own
/// `parseFreeformRecipe`/`importRecipeFromUrl` call and hand the result to
/// this controller. *Family*-keyed by the draft instance itself
/// (identity, not value equality — deliberately: a fresh fetch must always
/// start its own fresh review, never resume a stale edit left over from a
/// structurally-identical-looking earlier draft).
///
/// `autoDispose` because a family keyed by object identity is, by
/// definition, never a cache hit for a later draft — without `autoDispose`
/// every draft a household ever reviewed in a session would sit in the
/// provider container forever. Riverpod tears the provider down once its
/// review screen (the last widget watching it) unmounts.
class AiRecipeDraftController
    extends AutoDisposeFamilyNotifier<AiRecipeDraftState, AiRecipeDraft> {
  @override
  AiRecipeDraftState build(AiRecipeDraft arg) =>
      AiRecipeDraftState.fromDraft(arg);

  void updateTitle(ProposedField<String> value) =>
      state = state.copyWith(title: value);
  void updateDescription(ProposedField<String> value) =>
      state = state.copyWith(description: value);
  void updateServings(ProposedField<int> value) =>
      state = state.copyWith(servings: value);
  void updatePrepMin(ProposedField<int> value) =>
      state = state.copyWith(prepMin: value);
  void updateCookMin(ProposedField<int> value) =>
      state = state.copyWith(cookMin: value);
  void updateCuisineTier1(ProposedField<String> value) =>
      state = state.copyWith(cuisineTier1: value);
  void updateCuisineTier2(ProposedField<String> value) =>
      state = state.copyWith(cuisineTier2: value);
  void updateDietaryTags(ProposedField<List<String>> value) =>
      state = state.copyWith(dietaryTags: value);

  /// The one field with a locked product rule attached to how it may
  /// change (§13.2.6 D5) — still just a plain state replacement here; the
  /// rule itself is [AiRecipeDraftState.isRoleConfirmed], enforced by
  /// whatever screen gates its own submit button on it (S10).
  void updateRole(ProposedField<RecipeRole> value) =>
      state = state.copyWith(role: value);
  void updateIngredients(ProposedField<List<AiRecipeDraftIngredient>> value) =>
      state = state.copyWith(ingredients: value);
  void updateSteps(ProposedField<List<String>> value) =>
      state = state.copyWith(steps: value);
}

final AutoDisposeNotifierProviderFamily<
  AiRecipeDraftController,
  AiRecipeDraftState,
  AiRecipeDraft
>
aiRecipeDraftControllerProvider =
    NotifierProvider.autoDispose.family<
      AiRecipeDraftController,
      AiRecipeDraftState,
      AiRecipeDraft
    >(AiRecipeDraftController.new);
