import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/tokens.dart';
import '../domain/ai_recipe_draft.dart';
import '../domain/ai_recipe_draft_ingredient.dart';
import '../domain/proposed_field.dart';
import '../domain/recipe.dart';
import '../domain/recipe_draft.dart';
import '../domain/recipe_ingredient.dart';
import '../domain/recipe_ingredient_draft.dart';
import '../domain/recipe_patch.dart';
import '../domain/recipe_role.dart';
import '../domain/recipe_source.dart';
import '../domain/recipe_source_attribution.dart';
import '../domain/recipe_validation.dart';
import '../state/recipe_draft_controller.dart';
import '../state/recipe_form_controller.dart';
import 'ai_proposal.dart';
import 'recipes_error_copy.dart';
import 'ingredient_row_editor.dart';
import 'step_row_editor.dart';

/// Wireframe screen 8.2 — the structured create/edit form, pulled forward
/// from W7 (D2) — used for both create and edit (§11.2.7's seeded-form
/// reuse pattern, matching `ManualAddScreen`'s precedent exactly):
/// [initialRecipe] `null` means create (dispatches `createRecipe`);
/// non-`null` means edit, seeded from that recipe (dispatches
/// `updateRecipe` with only the scalar fields the user actually changed,
/// plus `ingredients`/`steps` sent whole whenever either list was touched
/// at all — see [_submit]'s own doc for the change-detection this needs
/// beyond a plain scalar diff). No async fetch-then-hydrate step, same
/// reasoning as `ManualAddScreen`: the recipe this screen edits is always
/// already in memory (Edit is only reachable from an already-loaded Detail
/// screen), so seeding happens once, synchronously, in `initState`.
///
/// **Role is required with no pre-selection** (E2E_MVP_PLAN.md §12.7 D1) —
/// [_role] starts `null` even for a recipe that somehow lacked one, and
/// [_isValid] blocks submit until the user has explicitly chosen one. This
/// is where "role assignment required" becomes visible to a user, not just
/// a server-side rule nobody sees.
///
/// **A third mode (W7 S10, D6):** [initialDraft] non-`null` means this
/// screen is reviewing an [AiRecipeDraft] proposed by `parseFreeformRecipe`
/// or `importRecipeFromUrl`, seeded the same way edit mode seeds from a
/// [Recipe] — a **seeded wrapper over this one screen, not a second form
/// implementation** (§11.2.7's pattern, third use). Every reviewable field
/// wraps its existing widget in [AIProposal], which renders the shared
/// "AI suggests" badge/semantics treatment until the user's first
/// interaction with that field, tracked through
/// [aiRecipeDraftControllerProvider] — the same shared draft-review
/// controller W7 S7 built for both this screen and S9's URL-import path.
/// Submitting in review mode always dispatches `createRecipe` (never
/// `updateRecipe`, since a draft was never persisted) with a [source]
/// attribution built from [sourceUrl]. **Scoping note:** [AiRecipeDraft]'s
/// `cuisineTier1`/`cuisineTier2`/`dietaryTags` are not reviewable here —
/// this screen has never had editing UI for those three fields in any
/// mode (a pre-existing W6 gap, not introduced by this slice), and adding
/// net-new picker UI for them would turn this "seeded wrapper" into
/// exactly the second form implementation D6 exists to avoid. A recipe
/// created through review therefore carries the identical field set a
/// structured create already does today — nothing silently added, nothing
/// silently dropped that used to work.
class RecipeFormScreen extends ConsumerStatefulWidget {
  const RecipeFormScreen({
    super.key,
    required this.householdId,
    this.initialRecipe,
    this.initialDraft,
    this.sourceUrl,
  }) : assert(
         initialRecipe == null || initialDraft == null,
         'RecipeFormScreen cannot seed from both a Recipe and an AiRecipeDraft.',
       );

  final String householdId;
  final Recipe? initialRecipe;

  /// Non-`null` puts this screen in review mode (W7 S10) — see this class's
  /// own doc.
  final AiRecipeDraft? initialDraft;

  /// The draft's source URL, shown as an attribution line in review mode
  /// and folded into the `source` argument on confirm. `null` means the
  /// draft came from freeform paste, not a URL import.
  final String? sourceUrl;

  static const Key titleFieldKey = Key('recipe-form-title');
  static const Key descriptionFieldKey = Key('recipe-form-description');
  static const Key servingsFieldKey = Key('recipe-form-servings');
  static const Key prepMinFieldKey = Key('recipe-form-prep-min');
  static const Key cookMinFieldKey = Key('recipe-form-cook-min');
  static const Key roleChipsKey = Key('recipe-form-role');
  static const Key inRotationChipKey = Key('recipe-form-in-rotation');
  static const Key addIngredientButtonKey = Key('recipe-form-add-ingredient');
  static const Key addStepButtonKey = Key('recipe-form-add-step');
  static const Key submitButtonKey = Key('recipe-form-submit');
  static const Key reviewAttributionKey = Key('recipe-form-review-attribution');
  static const Key reviewWarningsKey = Key('recipe-form-review-warnings');

  bool get isEditMode => initialRecipe != null;

  /// See this class's own doc — mutually exclusive with [isEditMode] by
  /// the constructor's own assert.
  bool get isReviewMode => initialDraft != null;

  @override
  ConsumerState<RecipeFormScreen> createState() => _RecipeFormScreenState();
}

/// One ingredient row's mutable editing state — a stable [id] (not the
/// row's current position, which changes on every reorder) is what
/// `ReorderableListView` needs as a per-item `Key`, and what lets
/// `IngredientRowEditor`'s controllers survive a reorder instead of being
/// rebuilt (and so losing focus/selection) under a new identity each time.
class _IngredientRow {
  _IngredientRow({
    required this.id,
    required String name,
    double? quantity,
    String? unit,
    this.isStaple = false,
    this.category,
    this.notes,
  }) : nameController = TextEditingController(text: name),
       quantityController = TextEditingController(
         text: quantity == null ? '' : _formatNumber(quantity),
       ),
       unitController = TextEditingController(text: unit ?? '');

  final int id;
  final TextEditingController nameController;
  final TextEditingController quantityController;
  final TextEditingController unitController;
  bool isStaple;

  /// Round-tripped unchanged — this screen has no UI to edit either field
  /// (`IngredientRowEditor`'s own doc explains why), but `ingredients` is a
  /// whole-list-replace patch field: without carrying these through, any
  /// edit that touches the ingredient list at all (even reordering) would
  /// silently null out `category`/`notes` on every ingredient in the
  /// recipe, not just the row the user actually touched.
  final String? category;
  final String? notes;

  void dispose() {
    nameController.dispose();
    quantityController.dispose();
    unitController.dispose();
  }
}

class _StepRow {
  _StepRow({required this.id, required String text})
    : controller = TextEditingController(text: text);

  final int id;
  final TextEditingController controller;

  void dispose() => controller.dispose();
}

/// Drops a trailing `.0` — matches `ManualAddScreen._formatNumber`.
String _formatNumber(double value) => value == value.roundToDouble()
    ? value.toInt().toString()
    : value.toString();

double? _parseNumber(String text) {
  final String trimmed = text.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  return double.tryParse(trimmed) ?? double.nan;
}

int? _parseInt(String text) {
  final String trimmed = text.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  return int.tryParse(trimmed);
}

class _RecipeFormScreenState extends ConsumerState<RecipeFormScreen> {
  late final TextEditingController _title;
  late final TextEditingController _description;
  late final TextEditingController _servings;
  late final TextEditingController _prepMin;
  late final TextEditingController _cookMin;
  RecipeRole? _role;
  bool _inRotation = true;
  final List<_IngredientRow> _ingredients = <_IngredientRow>[];
  final List<_StepRow> _steps = <_StepRow>[];
  int _nextRowId = 0;

  /// Captured once in [initState] (edit mode only) — the baseline
  /// [_currentIngredientDrafts]/[_currentStepDrafts] are compared against
  /// on submit, deciding whether `ingredients`/`steps` are sent at all (see
  /// [_submit]'s doc on why this is more than a scalar diff).
  List<RecipeIngredientDraft>? _initialIngredientDrafts;
  List<String>? _initialSteps;

  @override
  void initState() {
    super.initState();
    final Recipe? recipe = widget.initialRecipe;
    final AiRecipeDraft? draft = widget.initialDraft;
    _title = TextEditingController(text: recipe?.title ?? draft?.title ?? '');
    _description = TextEditingController(
      text: recipe?.description ?? draft?.description ?? '',
    );
    final int? seedServings = recipe?.servings ?? draft?.servings;
    _servings = TextEditingController(
      text: seedServings == null ? '' : seedServings.toString(),
    );
    final int? seedPrepMin = recipe?.prepMin ?? draft?.prepMin;
    _prepMin = TextEditingController(
      text: seedPrepMin == null ? '' : seedPrepMin.toString(),
    );
    final int? seedCookMin = recipe?.cookMin ?? draft?.cookMin;
    _cookMin = TextEditingController(
      text: seedCookMin == null ? '' : seedCookMin.toString(),
    );
    _role = recipe?.role ?? draft?.role;
    _inRotation = recipe?.inRotation ?? true;
    for (final TextEditingController controller in <TextEditingController>[
      _title,
      _description,
      _servings,
      _prepMin,
      _cookMin,
    ]) {
      controller.addListener(_onFieldChanged);
    }
    if (widget.isReviewMode) {
      _title.addListener(_markTitleEdited);
      _description.addListener(_markDescriptionEdited);
      _servings.addListener(_markServingsEdited);
      _prepMin.addListener(_markPrepMinEdited);
      _cookMin.addListener(_markCookMinEdited);
    }

    final List<RecipeIngredient>? existingIngredients = recipe?.ingredients;
    final List<AiRecipeDraftIngredient>? draftIngredients = draft?.ingredients;
    if (existingIngredients != null) {
      for (final RecipeIngredient ingredient in existingIngredients) {
        _ingredients.add(
          _IngredientRow(
            id: _nextRowId++,
            name: ingredient.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            isStaple: ingredient.isStaple,
            category: ingredient.category,
            notes: ingredient.notes,
          ),
        );
      }
      _initialIngredientDrafts = _ingredientDraftsFrom(_ingredients);
    } else if (draftIngredients != null) {
      // An AiRecipeDraftIngredient has no isStaple/category of its own —
      // only a structured create/edit form ever sets those, never an AI
      // parse.
      for (final AiRecipeDraftIngredient ingredient in draftIngredients) {
        _ingredients.add(
          _IngredientRow(
            id: _nextRowId++,
            name: ingredient.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            notes: ingredient.notes,
          ),
        );
      }
    }
    if (recipe != null) {
      for (final String step in recipe.steps) {
        _steps.add(_StepRow(id: _nextRowId++, text: step));
      }
      _initialSteps = List<String>.of(recipe.steps);
    } else if (draft != null) {
      for (final String step in draft.steps) {
        _steps.add(_StepRow(id: _nextRowId++, text: step));
      }
    }
    for (final _IngredientRow row in _ingredients) {
      row.nameController.addListener(_onFieldChanged);
      row.quantityController.addListener(_onFieldChanged);
      row.unitController.addListener(_onFieldChanged);
      if (widget.isReviewMode) {
        row.nameController.addListener(_markIngredientsEdited);
        row.quantityController.addListener(_markIngredientsEdited);
        row.unitController.addListener(_markIngredientsEdited);
      }
    }
    for (final _StepRow row in _steps) {
      row.controller.addListener(_onFieldChanged);
      if (widget.isReviewMode) {
        row.controller.addListener(_markStepsEdited);
      }
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _servings.dispose();
    _prepMin.dispose();
    _cookMin.dispose();
    for (final _IngredientRow row in _ingredients) {
      row.dispose();
    }
    for (final _StepRow row in _steps) {
      row.dispose();
    }
    super.dispose();
  }

  /// Shared by every field's controller (scalars and every ingredient/step
  /// row) — a keystroke anywhere rebuilds the whole form, not just the
  /// field that changed, because [_isValid]'s submit-button gate and
  /// per-row inline errors (e.g. `nameErrorText`) both need to be
  /// recomputed on any edit. That cost scales with the row count, up to
  /// `maxRecipeIngredients`/`maxRecipeSteps` (100 each) — an accepted
  /// trade-off for a typical recipe's row count (single digits to low
  /// tens), not fixed here since scoping rebuilds to individual rows would
  /// need a real per-row `Listenable`/notifier split, more machinery than
  /// this slice's actual point of uncertainty (the reorder mechanic) calls
  /// for. Revisit if S9's perf spike (or a future one scoped to this
  /// screen) finds it measurably janky at a realistic row count.
  void _onFieldChanged() => setState(() {});

  // ── Review-mode proposal tracking (W7 S10) ────────────────────────────
  //
  // Every method below is a no-op outside review mode. The Riverpod
  // `AiRecipeDraftController` per-field state tracked here exists purely
  // to drive each `AIProposal` wrapper's badge/semantics visibility — the
  // value actually submitted always comes from this screen's own local
  // controllers/lists (`_title.text`, `_role`, `_ingredients`, `_steps`),
  // exactly as it already does in create/edit mode. So the placeholder
  // value each `.edit(...)` call below carries is never read back; only
  // the resulting `isProposed: false` transition matters.

  AiRecipeDraftState get _draftState =>
      ref.read(aiRecipeDraftControllerProvider(widget.initialDraft!));

  AiRecipeDraftController get _draftNotifier =>
      ref.read(aiRecipeDraftControllerProvider(widget.initialDraft!).notifier);

  void _markTitleEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<String> field = _draftState.title;
    if (field.isProposed) {
      _draftNotifier.updateTitle(field.edit(_title.text));
    }
  }

  void _markDescriptionEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<String> field = _draftState.description;
    if (field.isProposed) {
      _draftNotifier.updateDescription(field.edit(_description.text));
    }
  }

  /// A cleared numeric field can't call `.edit(null)` — `ProposedField<T>`'s
  /// `edit` takes a non-null `T`. Falling back to `reject()` still clears
  /// the badge (the observable behaviour this exists for); it just doesn't
  /// mark the field `isUserModified` in that one edge case, which the
  /// ≤3-edits metric (§13.5.7) never measures against a cleared, still-empty
  /// numeric field anyway.
  void _markServingsEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<int> field = _draftState.servings;
    if (!field.isProposed) return;
    final int? parsed = _parseInt(_servings.text);
    _draftNotifier.updateServings(
      parsed == null ? field.reject() : field.edit(parsed),
    );
  }

  void _markPrepMinEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<int> field = _draftState.prepMin;
    if (!field.isProposed) return;
    final int? parsed = _parseInt(_prepMin.text);
    _draftNotifier.updatePrepMin(
      parsed == null ? field.reject() : field.edit(parsed),
    );
  }

  void _markCookMinEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<int> field = _draftState.cookMin;
    if (!field.isProposed) return;
    final int? parsed = _parseInt(_cookMin.text);
    _draftNotifier.updateCookMin(
      parsed == null ? field.reject() : field.edit(parsed),
    );
  }

  void _markIngredientsEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<List<AiRecipeDraftIngredient>> field =
        _draftState.ingredients;
    if (field.isProposed) {
      _draftNotifier.updateIngredients(
        field.edit(const <AiRecipeDraftIngredient>[]),
      );
    }
  }

  void _markStepsEdited() {
    if (!widget.isReviewMode) return;
    final ProposedField<List<String>> field = _draftState.steps;
    if (field.isProposed) {
      _draftNotifier.updateSteps(field.edit(const <String>[]));
    }
  }

  /// The one field with a locked confirm rule attached (§12.7 D1, §13.2.6
  /// D5): unlike every other field, a chip tap here never toggles off —
  /// review mode must always end with *some* role selected, so there is no
  /// "clear it back to unset" gesture to preserve. Tapping the
  /// already-proposed role again means **confirm** (`.accept()`); tapping a
  /// different one means **change** (`.edit()`).
  void _onRoleTap(RecipeRole role) {
    if (widget.isReviewMode) {
      final ProposedField<RecipeRole> field = _draftState.role;
      if (field.isProposed) {
        _draftNotifier.updateRole(
          field.value == role ? field.accept() : field.edit(role),
        );
      }
      setState(() => _role = role);
    } else {
      setState(() => _role = _role == role ? null : role);
    }
  }

  void _addIngredient() {
    final _IngredientRow row = _IngredientRow(id: _nextRowId++, name: '');
    row.nameController.addListener(_onFieldChanged);
    row.quantityController.addListener(_onFieldChanged);
    row.unitController.addListener(_onFieldChanged);
    if (widget.isReviewMode) {
      row.nameController.addListener(_markIngredientsEdited);
      row.quantityController.addListener(_markIngredientsEdited);
      row.unitController.addListener(_markIngredientsEdited);
    }
    setState(() => _ingredients.add(row));
    _markIngredientsEdited();
  }

  void _removeIngredient(int index) {
    final _IngredientRow row = _ingredients[index];
    setState(() => _ingredients.removeAt(index));
    row.dispose();
    _markIngredientsEdited();
  }

  // `onReorderItem`, not the deprecated `onReorder`: this callback's own
  // `newIndex` is already adjusted for the removed item at `oldIndex`, so
  // unlike `onReorder` there is no `if (newIndex > oldIndex) newIndex -= 1`
  // workaround needed here.
  void _reorderIngredients(int oldIndex, int newIndex) {
    setState(() {
      final _IngredientRow row = _ingredients.removeAt(oldIndex);
      _ingredients.insert(newIndex, row);
    });
    _markIngredientsEdited();
  }

  void _addStep() {
    final _StepRow row = _StepRow(id: _nextRowId++, text: '');
    row.controller.addListener(_onFieldChanged);
    if (widget.isReviewMode) {
      row.controller.addListener(_markStepsEdited);
    }
    setState(() => _steps.add(row));
    _markStepsEdited();
  }

  void _removeStep(int index) {
    final _StepRow row = _steps[index];
    setState(() => _steps.removeAt(index));
    row.dispose();
    _markStepsEdited();
  }

  // See `_reorderIngredients`'s doc on why no index adjustment is needed
  // with `onReorderItem`.
  void _reorderSteps(int oldIndex, int newIndex) {
    setState(() {
      final _StepRow row = _steps.removeAt(oldIndex);
      _steps.insert(newIndex, row);
    });
    _markStepsEdited();
  }

  static List<RecipeIngredientDraft> _ingredientDraftsFrom(
    List<_IngredientRow> rows,
  ) => rows
      .map(
        (_IngredientRow row) => RecipeIngredientDraft(
          name: row.nameController.text.trim(),
          quantity: _parseNumber(row.quantityController.text),
          unit: row.unitController.text.trim().isEmpty
              ? null
              : row.unitController.text.trim(),
          isStaple: row.isStaple,
          category: row.category,
          notes: row.notes,
        ),
      )
      .toList(growable: false);

  List<String> get _currentSteps => _steps
      .map((_StepRow row) => row.controller.text.trim())
      .toList(growable: false);

  bool get _isValid {
    if (validateRecipeTitle(_title.text) != null) {
      return false;
    }
    if (_role == null) {
      return false;
    }
    // §13.2.6 D5 — an AI-proposed role must be affirmatively confirmed or
    // changed before submit, never silently carried through untouched.
    // `field.value != null` excludes the case the draft never proposed a
    // role at all, which the `_role == null` check just above already
    // blocks on its own.
    if (widget.isReviewMode) {
      final ProposedField<RecipeRole> roleField = _draftState.role;
      if (roleField.isProposed && roleField.value != null) {
        return false;
      }
    }
    if (validateRecipeDescription(_description.text) != null) {
      return false;
    }
    final int? servings = _parseInt(_servings.text);
    if (_servings.text.trim().isNotEmpty && servings == null) {
      return false;
    }
    if (validateRecipeServings(servings) != null) {
      return false;
    }
    final int? prepMin = _parseInt(_prepMin.text);
    if (_prepMin.text.trim().isNotEmpty && prepMin == null) {
      return false;
    }
    if (validateRecipeMinutes(prepMin, 'prepMin') != null) {
      return false;
    }
    final int? cookMin = _parseInt(_cookMin.text);
    if (_cookMin.text.trim().isNotEmpty && cookMin == null) {
      return false;
    }
    if (validateRecipeMinutes(cookMin, 'cookMin') != null) {
      return false;
    }
    if (_ingredients.length > maxRecipeIngredients) {
      return false;
    }
    for (final _IngredientRow row in _ingredients) {
      if (validateRecipeIngredientName(row.nameController.text) != null) {
        return false;
      }
      // `_parseNumber` never returns `null` for non-empty text — an
      // unparseable string becomes `double.nan`, which
      // `validateRecipeIngredientQuantity`'s own `isNaN` check below
      // already rejects. No separate `== null` branch is reachable here.
      final double? quantity = _parseNumber(row.quantityController.text);
      if (validateRecipeIngredientQuantity(quantity) != null) {
        return false;
      }
      if (validateRecipeIngredientUnit(row.unitController.text) != null) {
        return false;
      }
    }
    if (_steps.length > maxRecipeSteps) {
      return false;
    }
    for (final _StepRow row in _steps) {
      if (validateRecipeStep(row.controller.text) != null) {
        return false;
      }
    }
    return true;
  }

  /// Builds the draft/patch and submits.
  ///
  /// Edit mode's `ingredients`/`steps` need more than a plain scalar diff:
  /// [RecipePatch]'s `null` = unchanged / any list = replace semantic means
  /// sending the current list *only when it actually differs* from what the
  /// recipe started with (order included — a pure reorder is still a real
  /// change to send), and sending nothing at all otherwise, so an untouched
  /// list is never silently re-sent as a no-op "replace with the same
  /// thing" the server would have to process for nothing.
  Future<void> _submit() async {
    final RecipeFormController controller = ref.read(
      recipeFormControllerProvider.notifier,
    );
    final String title = _title.text.trim();
    final String? description = _description.text.trim().isEmpty
        ? null
        : _description.text.trim();
    final int? servings = _parseInt(_servings.text);
    final int? prepMin = _parseInt(_prepMin.text);
    final int? cookMin = _parseInt(_cookMin.text);
    final RecipeRole role = _role!;
    final List<RecipeIngredientDraft> currentIngredients =
        _ingredientDraftsFrom(_ingredients);
    final List<String> currentSteps = _currentSteps;

    final Recipe? existing = widget.initialRecipe;
    final bool ok;
    if (existing == null) {
      // Review mode (`widget.isReviewMode`) always lands here too — a
      // draft was never persisted, so confirming it is a create, never an
      // update. `source` (W7 S6) attributes it: `url` when this draft came
      // from `importRecipeFromUrl` (S9), `freeform_ai` otherwise (S10).
      final RecipeSourceAttribution? source = widget.isReviewMode
          ? RecipeSourceAttribution(
              sourceType: widget.sourceUrl == null
                  ? RecipeSource.freeformAi
                  : RecipeSource.url,
              sourceUrl: widget.sourceUrl,
            )
          : null;
      ok = await controller.create(
        widget.householdId,
        RecipeDraft(
          title: title,
          description: description,
          servings: servings,
          prepMin: prepMin,
          cookMin: cookMin,
          role: role,
          inRotation: _inRotation,
          ingredients: currentIngredients,
          steps: currentSteps,
        ),
        source: source,
      );
    } else {
      final List<RecipeIngredientDraft>? initialIngredients =
          _initialIngredientDrafts;
      final List<String>? initialSteps = _initialSteps;
      final bool ingredientsChanged =
          initialIngredients == null ||
          !listEquals(initialIngredients, currentIngredients);
      final bool stepsChanged =
          initialSteps == null || !listEquals(initialSteps, currentSteps);

      final String? patchTitle = title != existing.title ? title : null;
      final String? patchDescription = description != existing.description
          ? description
          : null;
      final int? patchServings = servings != existing.servings
          ? servings
          : null;
      final int? patchPrepMin = prepMin != existing.prepMin ? prepMin : null;
      final int? patchCookMin = cookMin != existing.cookMin ? cookMin : null;
      final RecipeRole? patchRole = role != existing.role ? role : null;
      final bool? patchInRotation = _inRotation != existing.inRotation
          ? _inRotation
          : null;
      final List<RecipeIngredientDraft>? patchIngredients = ingredientsChanged
          ? currentIngredients
          : null;
      final List<String>? patchSteps = stepsChanged ? currentSteps : null;

      final bool nothingChanged =
          patchTitle == null &&
          patchDescription == null &&
          patchServings == null &&
          patchPrepMin == null &&
          patchCookMin == null &&
          patchRole == null &&
          patchInRotation == null &&
          patchIngredients == null &&
          patchSteps == null;
      if (nothingChanged) {
        // Nothing to save — not an error, matching `ManualAddScreen`'s
        // identical no-op-is-not-a-failure convention. Checked *before*
        // constructing `RecipePatch`: that constructor asserts at least one
        // field is non-null, so building it first would crash on exactly
        // this no-op-save path instead of popping cleanly.
        if (mounted) {
          context.pop();
        }
        return;
      }

      final RecipePatch patch = RecipePatch(
        title: patchTitle,
        description: patchDescription,
        servings: patchServings,
        prepMin: patchPrepMin,
        cookMin: patchCookMin,
        role: patchRole,
        inRotation: patchInRotation,
        ingredients: patchIngredients,
        steps: patchSteps,
      );

      ok = await controller.updateRecipe((
        householdId: widget.householdId,
        id: existing.id,
      ), patch);
    }

    if (!mounted) {
      return;
    }
    if (ok) {
      context.pop();
    }
  }

  /// No-op (returns [child] unwrapped) outside review mode or when [field]
  /// carries nothing to propose — see the "review-mode proposal tracking"
  /// block above for why the value inside [field] is never read here.
  Widget _proposalWrap<T>({
    required ProposedField<T>? field,
    required ValueChanged<ProposedField<T>>? onChanged,
    required Widget child,
  }) {
    if (field == null || onChanged == null) {
      return child;
    }
    return AIProposal<T>(
      field: field,
      onChanged: onChanged,
      builder: (context, _, onEdit, onAccept, onReject) => child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> formState = ref.watch(recipeFormControllerProvider);
    final bool isBusy = formState.isLoading;
    final String? errorMessage = recipeErrorMessage(formState.error);
    final AiRecipeDraftState? draftState = widget.isReviewMode
        ? ref.watch(aiRecipeDraftControllerProvider(widget.initialDraft!))
        : null;
    final AiRecipeDraftController? draftNotifier = widget.isReviewMode
        ? ref.read(aiRecipeDraftControllerProvider(widget.initialDraft!).notifier)
        : null;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: widget.isReviewMode
                  ? 'Review recipe'
                  : widget.isEditMode
                  ? 'Edit recipe'
                  : 'New recipe',
              onBack: () => context.pop(),
              backSemanticLabel: widget.isEditMode
                  ? 'Back to recipe'
                  : 'Back to recipes',
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.s3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    if (widget.isReviewMode) ...<Widget>[
                      Text(
                        widget.sourceUrl == null
                            ? 'From pasted text'
                            : 'From ${widget.sourceUrl}',
                        key: RecipeFormScreen.reviewAttributionKey,
                        style: AppTypography.label.copyWith(
                          color: AppColors.inkMid,
                        ),
                      ),
                      if (draftState!.warnings.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: AppSpacing.s1),
                          child: _ReviewWarnings(warnings: draftState.warnings),
                        ),
                      const SizedBox(height: AppSpacing.s2),
                    ],
                    _proposalWrap<String>(
                      field: draftState?.title,
                      onChanged: draftNotifier?.updateTitle,
                      child: PInput(
                        key: RecipeFormScreen.titleFieldKey,
                        label: 'Title',
                        hintText: 'Toor Dal',
                        controller: _title,
                        enabled: !isBusy,
                        autofocus: !widget.isEditMode && !widget.isReviewMode,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    Text(
                      'ROLE',
                      style: AppTypography.meta.copyWith(
                        color: AppColors.inkMid,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s1),
                    _proposalWrap<RecipeRole>(
                      field: draftState?.role,
                      onChanged: draftNotifier?.updateRole,
                      child: Wrap(
                        key: RecipeFormScreen.roleChipsKey,
                        spacing: AppSpacing.s1,
                        runSpacing: AppSpacing.s1,
                        children: <Widget>[
                          for (final RecipeRole role in RecipeRole.selectable)
                            PChip(
                              label: role.displayLabel,
                              selected: _role == role,
                              onTap: isBusy ? null : () => _onRoleTap(role),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    _proposalWrap<String>(
                      field: draftState?.description,
                      onChanged: draftNotifier?.updateDescription,
                      child: PInput(
                        key: RecipeFormScreen.descriptionFieldKey,
                        label: 'Description (optional)',
                        controller: _description,
                        enabled: !isBusy,
                        minLines: 1,
                        maxLines: 4,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: _proposalWrap<int>(
                            field: draftState?.servings,
                            onChanged: draftNotifier?.updateServings,
                            child: PInput(
                              key: RecipeFormScreen.servingsFieldKey,
                              label: 'Servings',
                              hintText: '4',
                              controller: _servings,
                              enabled: !isBusy,
                              keyboardType: TextInputType.number,
                              useMonoFont: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.s1),
                        Expanded(
                          child: _proposalWrap<int>(
                            field: draftState?.prepMin,
                            onChanged: draftNotifier?.updatePrepMin,
                            child: PInput(
                              key: RecipeFormScreen.prepMinFieldKey,
                              label: 'Prep (min)',
                              hintText: '10',
                              controller: _prepMin,
                              enabled: !isBusy,
                              keyboardType: TextInputType.number,
                              useMonoFont: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.s1),
                        Expanded(
                          child: _proposalWrap<int>(
                            field: draftState?.cookMin,
                            onChanged: draftNotifier?.updateCookMin,
                            child: PInput(
                              key: RecipeFormScreen.cookMinFieldKey,
                              label: 'Cook (min)',
                              hintText: '20',
                              controller: _cookMin,
                              enabled: !isBusy,
                              keyboardType: TextInputType.number,
                              useMonoFont: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    PChip(
                      key: RecipeFormScreen.inRotationChipKey,
                      label: 'In rotation',
                      selected: _inRotation,
                      onTap: isBusy
                          ? null
                          : () => setState(() => _inRotation = !_inRotation),
                    ),
                    const SizedBox(height: AppSpacing.s3),
                    _proposalWrap<List<AiRecipeDraftIngredient>>(
                      field: draftState?.ingredients,
                      onChanged: draftNotifier?.updateIngredients,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'Ingredients',
                            style: AppTypography.title.copyWith(
                              color: AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.s1),
                          ReorderableListView(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            buildDefaultDragHandles: false,
                            onReorderItem: isBusy
                                ? (_, _) {}
                                : _reorderIngredients,
                            children: <Widget>[
                              for (int i = 0; i < _ingredients.length; i++)
                                Padding(
                                  key: ValueKey<int>(_ingredients[i].id),
                                  padding: const EdgeInsets.only(
                                    bottom: AppSpacing.s1,
                                  ),
                                  child: IngredientRowEditor(
                                    index: i,
                                    nameController:
                                        _ingredients[i].nameController,
                                    quantityController:
                                        _ingredients[i].quantityController,
                                    unitController:
                                        _ingredients[i].unitController,
                                    isStaple: _ingredients[i].isStaple,
                                    onStapleChanged: (bool value) => setState(
                                      () => _ingredients[i].isStaple = value,
                                    ),
                                    onRemove: () => _removeIngredient(i),
                                    enabled: !isBusy,
                                    nameErrorText: validateRecipeIngredientName(
                                      _ingredients[i].nameController.text,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          PButton(
                            key: RecipeFormScreen.addIngredientButtonKey,
                            label: 'Add ingredient',
                            variant: PButtonVariant.secondary,
                            onPressed: isBusy ? null : _addIngredient,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s3),
                    _proposalWrap<List<String>>(
                      field: draftState?.steps,
                      onChanged: draftNotifier?.updateSteps,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'Steps',
                            style: AppTypography.title.copyWith(
                              color: AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.s1),
                          ReorderableListView(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            buildDefaultDragHandles: false,
                            onReorderItem: isBusy ? (_, _) {} : _reorderSteps,
                            children: <Widget>[
                              for (int i = 0; i < _steps.length; i++)
                                StepRowEditor(
                                  key: ValueKey<int>(_steps[i].id),
                                  index: i,
                                  controller: _steps[i].controller,
                                  onRemove: () => _removeStep(i),
                                  enabled: !isBusy,
                                ),
                            ],
                          ),
                          PButton(
                            key: RecipeFormScreen.addStepButtonKey,
                            label: 'Add step',
                            variant: PButtonVariant.secondary,
                            onPressed: isBusy ? null : _addStep,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (errorMessage != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.s3,
                  0,
                  AppSpacing.s3,
                  AppSpacing.s2,
                ),
                child: Text(
                  errorMessage,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.s3,
                0,
                AppSpacing.s3,
                AppSpacing.s3,
              ),
              child: PButton(
                key: RecipeFormScreen.submitButtonKey,
                label: widget.isReviewMode
                    ? 'Save recipe'
                    : widget.isEditMode
                    ? 'Save changes'
                    : 'Create recipe',
                isLoading: isBusy,
                expand: true,
                onPressed: _isValid ? _submit : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The draft's non-blocking notes (review mode only) — same visual
/// language as `AIProposal`'s own private `_WarningsList` (info icon,
/// `AppColors.inkMid`, never error-styled: a draft with warnings is still
/// a usable draft), rendered once at the top of the form rather than
/// per-field since a warning isn't necessarily about any one field.
class _ReviewWarnings extends StatelessWidget {
  const _ReviewWarnings({required this.warnings});

  final List<String> warnings;

  @override
  Widget build(BuildContext context) => Column(
    key: RecipeFormScreen.reviewWarningsKey,
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: warnings
        .map(
          (warning) => Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s0),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Icon(
                  Icons.info_outline,
                  size: AppSizing.icon16,
                  color: AppColors.inkMid,
                ),
                const SizedBox(width: AppSpacing.s0),
                Expanded(
                  child: Text(
                    warning,
                    style: AppTypography.label.copyWith(
                      color: AppColors.inkMid,
                    ),
                  ),
                ),
              ],
            ),
          ),
        )
        .toList(growable: false),
  );
}
