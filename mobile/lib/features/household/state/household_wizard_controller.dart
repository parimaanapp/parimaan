import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../data/household_repository.dart';
import '../domain/cuisine_taxonomy.dart';
import '../domain/dietary_tag.dart';
import '../domain/household.dart';
import '../domain/household_settings_patch.dart';
import '../domain/meal_structure.dart';
import '../domain/meal_type.dart';
import 'household_wizard_data.dart';
import 'household_wizard_hydration.dart';

export 'household_wizard_data.dart';

/// Owns the six-screen household setup wizard.
///
/// ## Two kinds of method, and the line between them
///
///  * **Draft edits** ([toggleMeal], [setSlotCount], [toggleRegion],
///    [setBias], [toggleDietaryTag], the allergen/skip-list mutators) are
///    synchronous and never touch the network. Tapping a chip should not cost
///    a round trip against an Aurora instance that may be resuming.
///  * **Step submits** (`submitX`) send exactly one step's fields and are the
///    only methods that call the repository.
///
/// That split is what "create at step 1, patch per step" means in practice:
/// the household exists from screen 2.1 onward, and each Continue commits one
/// step. A user who abandons the wizard midway keeps everything they already
/// confirmed rather than losing all six screens.
///
/// ## Error handling
///
/// Every `submitX` **never throws** — the outcome lands in `state`, with the
/// concrete `AppError` subtype intact, exactly as `CreateHouseholdController`
/// does and for the same reason: the screens pattern-match the subtype, so
/// collapsing it here would throw away the only thing that makes a
/// `RATE_LIMITED` message different from a `VALIDATION` one.
///
/// Unlike `CreateHouseholdController`, loading and error states are built with
/// `copyWithPrevious` so the draft stays readable underneath. A user who hits
/// `FORBIDDEN` on step 3 must not lose steps 1–3's answers to a blank screen.
///
/// ## What the server's response is *not* used for
///
/// `updateHouseholdSettings` returns the whole `Household` (W8 S10 widened
/// it from just the settings row). That value is deliberately discarded
/// rather than folded back into the draft: the draft is what the user is
/// currently editing, and overwriting it with a server round trip's
/// snapshot would clobber any edit made while the request was in flight.
/// The server remains the authority on what is *stored*; this controller is
/// the authority on what is *being edited*.
class HouseholdWizardController extends AsyncNotifier<HouseholdWizardData> {
  /// `read`, not `watch` — same reasoning as `CreateHouseholdController`:
  /// building this notifier must not construct a GraphQL client, so a screen
  /// can be pumped in a widget test with no client override at all.
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  @override
  Future<HouseholdWizardData> build() async => HouseholdWizardData();

  /// The draft as it stands, or `null` if the notifier has not built yet.
  HouseholdWizardData? get _draft => state.valueOrNull;

  /// Replaces the draft, **clearing any stale error**.
  ///
  /// Editing after a failure is the user acting on the error message, so
  /// leaving the old message on screen while they change their answer would
  /// be stale. Same behaviour as `FirstRunChoosePathScreen`'s clear-on-edit.
  void _updateDraft(HouseholdWizardData Function(HouseholdWizardData) change) {
    final HouseholdWizardData? current = _draft;
    if (current == null) {
      return;
    }
    state = AsyncData<HouseholdWizardData>(change(current));
  }

  /// Takes ownership of the household screen 2.1 just created.
  ///
  /// Screen 2.1 dispatches through `CreateHouseholdController` — the create
  /// mutation already has a controller, and duplicating it here would give the
  /// app two code paths that can create a household. This is the hand-off
  /// between the two.
  void adoptHousehold(Household household) =>
      _updateDraft((HouseholdWizardData d) => d.copyWith(household: household));

  /// Replaces the whole draft with [household]'s **stored** settings.
  ///
  /// The Settings edit flow's entry point, and the mirror image of
  /// [adoptHousehold]: that one keeps the in-progress draft and attaches a
  /// household to it, this one throws the draft away and rebuilds it from the
  /// server's row.
  ///
  /// Replacing rather than merging is required, not merely simpler. Every
  /// patch this controller sends is a **whole-list replacement** — see
  /// `HouseholdSettingsPatch.meals` and friends — so a draft holding wizard
  /// defaults for the five fields the user did not come here to edit would
  /// silently reset them the moment Save was pressed on the sixth.
  ///
  /// Decoding is defensive throughout; see `household_wizard_hydration.dart`.
  void hydrateFrom(Household household) => state =
      AsyncData<HouseholdWizardData>(wizardDataFromHousehold(household));

  // ── Screen 2.2 — which meals ──────────────────────────────────────────────

  void toggleMeal(MealType meal) => _updateDraft((HouseholdWizardData d) {
    final Set<MealType> next = Set<MealType>.of(d.mealsEnabled);
    next.contains(meal) ? next.remove(meal) : next.add(meal);
    return d.copyWith(mealsEnabled: next);
  });

  Future<void> submitMealsEnabled() async {
    final HouseholdWizardData? draft = _draft;
    if (draft == null) return;
    await _submit(HouseholdSettingsPatch.meals(draft.mealsEnabled));
  }

  // ── Screen 2.3 — lunch structure ──────────────────────────────────────────

  void setSlotCount(MealSlot slot, int count) => _updateDraft(
    (HouseholdWizardData d) =>
        d.copyWith(lunchStructure: d.lunchStructure.withCount(slot, count)),
  );

  Future<void> submitMealStructure() async {
    final HouseholdWizardData? draft = _draft;
    if (draft == null) return;
    await _submit(HouseholdSettingsPatch.lunchStructure(draft.lunchStructure));
  }

  // ── Screen 2.4 — cuisine regions ──────────────────────────────────────────

  /// Toggles a Tier 1 region and re-derives the Tier 2 bias map.
  ///
  /// Re-deriving here rather than on screen 2.5 keeps the invariant in one
  /// place: `subCuisineWeights`' keys are *always* exactly the sub-cuisines of
  /// the selected regions, so screen 2.5 can render straight from the map and
  /// the patch can never carry a bias for a region the household dropped.
  void toggleRegion(CuisineRegion region) => _updateDraft((
    HouseholdWizardData d,
  ) {
    final Set<CuisineRegion> next = Set<CuisineRegion>.of(d.regions);
    next.contains(region) ? next.remove(region) : next.add(region);
    return d.copyWith(
      regions: next,
      subCuisineWeights: defaultWeightsFor(next, existing: d.subCuisineWeights),
    );
  });

  Future<void> submitCuisineRegions() async {
    final HouseholdWizardData? draft = _draft;
    if (draft == null) return;
    await _submit(HouseholdSettingsPatch.cuisineRegions(draft.regions));
  }

  // ── Screen 2.5 — sub-cuisine bias ─────────────────────────────────────────

  void setBias(String subCuisineKey, CuisineBias bias) => _updateDraft(
    (HouseholdWizardData d) => d.copyWith(
      subCuisineWeights: <String, CuisineBias>{
        ...d.subCuisineWeights,
        subCuisineKey: bias,
      },
    ),
  );

  Future<void> submitCuisineSubAndBias() async {
    final HouseholdWizardData? draft = _draft;
    if (draft == null) return;
    await _submit(
      HouseholdSettingsPatch.cuisineWeights(draft.subCuisineWeights),
    );
  }

  // ── Screen 2.6 — dietary, allergens, skip list ────────────────────────────

  void toggleDietaryTag(DietaryTag tag) =>
      _updateDraft((HouseholdWizardData d) {
        final Set<DietaryTag> next = Set<DietaryTag>.of(d.dietaryTags);
        next.contains(tag) ? next.remove(tag) : next.add(tag);
        return d.copyWith(dietaryTags: next);
      });

  void addAllergen(String value) => _updateDraft(
    (HouseholdWizardData d) =>
        d.copyWith(allergens: _appended(d.allergens, value)),
  );

  void removeAllergen(String value) => _updateDraft(
    (HouseholdWizardData d) => d.copyWith(
      allergens: d.allergens.where((String e) => e != value).toList(),
    ),
  );

  void addSkipIngredient(String value) => _updateDraft(
    (HouseholdWizardData d) =>
        d.copyWith(skipIngredients: _appended(d.skipIngredients, value)),
  );

  void removeSkipIngredient(String value) => _updateDraft(
    (HouseholdWizardData d) => d.copyWith(
      skipIngredients: d.skipIngredients
          .where((String e) => e != value)
          .toList(),
    ),
  );

  Future<void> submitDietaryAndAllergens() async {
    final HouseholdWizardData? draft = _draft;
    if (draft == null) return;
    await _submit(
      HouseholdSettingsPatch.dietary(
        tags: draft.dietaryTags,
        allergens: draft.allergens,
        skipIngredients: draft.skipIngredients,
      ),
    );
  }

  // ── Shared submit path ────────────────────────────────────────────────────

  /// Sends one step's [patch] and parks the outcome in `state`.
  ///
  /// The draft is carried through every transition via `copyWithPrevious`, so
  /// the screen keeps rendering the user's answers while the request is in
  /// flight and after it fails.
  Future<void> _submit(HouseholdSettingsPatch patch) async {
    final HouseholdWizardData? draft = _draft;
    if (draft == null) {
      return;
    }

    final String? householdId = draft.householdId;
    if (householdId == null) {
      // Reaching a setup screen with no household means the wizard was entered
      // out of order (a deep link straight to /household/create/meals, say).
      // Surfacing it as an `AppError` rather than throwing keeps the screens'
      // single error-rendering path working, and keeps this method's
      // never-throws contract.
      state = AsyncError<HouseholdWizardData>(
        const InternalError(
          'Your household setup was interrupted. Start again from the '
          'household name.',
        ),
        StackTrace.current,
      ).copyWithPrevious(AsyncData<HouseholdWizardData>(draft));
      return;
    }

    // `AsyncData(draft)` rather than `state` as the previous value: a retry
    // must not carry the *previous attempt's* error underneath the spinner.
    state = const AsyncLoading<HouseholdWizardData>().copyWithPrevious(
      AsyncData<HouseholdWizardData>(draft),
    );

    final AsyncValue<HouseholdWizardData> result =
        await AsyncValue.guard<HouseholdWizardData>(() async {
          await _repository.updateHouseholdSettings(householdId, patch);
          // The server's returned settings row is deliberately not folded back
          // in — see the class doc.
          return _draft ?? draft;
        });

    state = result.hasError
        ? result.copyWithPrevious(
            AsyncData<HouseholdWizardData>(_draft ?? draft),
          )
        : result;
  }
}

/// [values] plus [value], trimmed, ignoring blanks and duplicates.
///
/// Allergens and skip ingredients are free text (`[String!]` in the schema,
/// no enum), so this is the only normalisation there is. De-duplicating and
/// trimming client-side keeps two spellings of the same word out of a list
/// the shopping-list generator will later hard-filter on.
List<String> _appended(List<String> values, String value) {
  final String trimmed = value.trim();
  if (trimmed.isEmpty || values.contains(trimmed)) {
    return values;
  }
  return <String>[...values, trimmed];
}

final AsyncNotifierProvider<HouseholdWizardController, HouseholdWizardData>
householdWizardControllerProvider =
    AsyncNotifierProvider<HouseholdWizardController, HouseholdWizardData>(
      HouseholdWizardController.new,
    );
