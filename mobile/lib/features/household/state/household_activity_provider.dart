import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../menu/domain/current_week.dart';
import '../../menu/domain/menu.dart';
import '../../menu/state/current_menu_controller.dart';
import '../../pantry/domain/pantry_item.dart';
import '../../pantry/state/pantry_controller.dart';
import '../../recipes/domain/recipe.dart';
import '../../recipes/state/recipe_library_controller.dart';
import '../domain/household.dart';
import 'me_households_controller.dart';

/// Q20's "has this household done anything real yet?" predicate
/// (E2E_MVP_PLAN.md §19.2.2 D2, W13 S6): **≥1 recipe OR ≥1 pantry item OR
/// ≥1 planned menu item**, for the first household `meHouseholdsControllerProvider`
/// resolved — same "first" convention `activeHouseholdProvider`'s own doc
/// uses, since a real household switcher doesn't exist yet either.
///
/// ## Placement judgment call (W13 S6, §19.2.2)
///
/// D2 locks the *threshold* and locks that no new schema/query is added,
/// but deliberately leaves **where** the three-way OR is computed as an
/// open, flagged choice between inline-in-`_redirect` and a small derived
/// provider like this one. **This slice takes the derived-provider
/// option** — the plan's own lean, for two reasons that held up once
/// actually writing the code: (1) `_redirect` (`app/router.dart`) was
/// already the file's longest single function before this slice touched
/// it, and Q20's three-source OR would have made it materially longer and
/// harder to read as one function; (2) this provider is directly
/// unit-testable through a bare `ProviderContainer` — see
/// `household_activity_provider_test.dart` — without driving the router or
/// a widget tree at all, which is a strictly cheaper way to cover the OR's
/// own truth table (all eight resolving/errored/empty/non-empty
/// combinations across the three sources) than routing every combination
/// through `router_test.dart`'s widget-level harness.
///
/// ## Three states, not two — the same non-negotiable discipline `_redirect`
/// already applies to `meHouseholdsControllerProvider`
///
/// The returned [AsyncValue] is deliberately not "resolved bool" vs.
/// "loading" — it collapses **both** "still resolving" and "errored" into
/// [AsyncValue.loading]. That collapse is the whole point, not a shortcut:
/// D2 is explicit that an errored source must be treated as *unknown*, and
/// held on splash exactly like a still-resolving one — never read as
/// "empty" and used to bounce a returning household to `/welcome`. This is
/// the OPPOSITE of how `_redirect`'s own household-existence check treats
/// an error (there, an errored query is read as "no households," because
/// `/first-run` is a safe universal landing for an unknown answer);
/// `/welcome` is not a safe landing for a household that actually has
/// data, so that shortcut is not available here. A caller only ever needs
/// to ask "do I have a value" (hold on splash if not) and, if so, "what is
/// it" — never "was it an error or a loading state," which is why
/// collapsing the two costs nothing a caller needs.
///
/// ## Derives nothing new
///
/// Every one of the three sources below is a Riverpod provider this app
/// already has fetching for its own screens (`RecipesLibraryScreen`'s
/// `recipeLibraryControllerProvider`, `PantryListScreen`'s
/// `pantryControllerProvider`, `WeeklyPlanScreen`'s
/// `currentMenuControllerProvider`) — this provider only reads their
/// already-loaded (or already-loading) state and combines it. No new
/// schema, no new resolver, no new dedicated "has activity" query (D2's
/// other non-negotiable half).
final Provider<AsyncValue<bool>> householdHasActivityProvider =
    Provider<AsyncValue<bool>>((Ref ref) {
      final AsyncValue<List<Household>> households = ref.watch(
        meHouseholdsControllerProvider,
      );
      final List<Household>? list = households.valueOrNull;
      if (list == null || list.isEmpty) {
        // No household to check activity for — every real caller of this
        // provider only reads it once `_redirect` has already established
        // `hasHouseholds`, so this branch is never actually consulted for
        // its value on that path. `false` (not `loading`) so a stray read
        // elsewhere fails closed rather than holding forever.
        return const AsyncValue<bool>.data(false);
      }
      final String householdId = list.first.id;

      final AsyncValue<List<Recipe>> recipes = ref.watch(
        recipeLibraryControllerProvider(householdId),
      );
      final AsyncValue<List<PantryItem>> pantry = ref.watch(
        pantryControllerProvider(householdId),
      );
      final AsyncValue<Menu> menu = ref.watch(
        currentMenuControllerProvider(
          menuKeyFor(householdId, currentWeekStartDate()),
        ),
      );

      if (!recipes.hasValue || !pantry.hasValue || !menu.hasValue) {
        return const AsyncValue<bool>.loading();
      }

      final bool hasRecipes = recipes.value!.isNotEmpty;
      final bool hasPantryItems = pantry.value!.isNotEmpty;
      final bool hasMenuItems = menu.value!.items.isNotEmpty;

      return AsyncValue<bool>.data(
        hasRecipes || hasPantryItems || hasMenuItems,
      );
    });
