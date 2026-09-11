import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../data/pantry_repository.dart';
import '../domain/curated_pantry_selection.dart';
import '../domain/pantry_item.dart';
import '../domain/pantry_item_draft.dart';
import '../domain/pantry_item_patch.dart';
import 'pantry_controller.dart';

/// Which action last ran, so Manual Add and the delete dialog can each show
/// their own spinner without one lighting up the other — same reasoning as
/// `HouseholdSettingsController`'s `HouseholdSettingsAction`.
enum PantryFormAction { none, add, bulkAdd, update, delete }

/// The client-side mirror of `api/src/validation/bulkAddPantryItems.ts`'s
/// cap (E2E_MVP_PLAN.md §20.2.7 D7). The server enforces this too — this
/// constant exists so [PantryFormController.bulkAdd] can refuse an
/// oversized selection **honestly**, with a visible message, instead of
/// either silently truncating it or making the user wait on a network
/// round trip only to learn the same thing from a `VALIDATION` error.
const int maxBulkAddPantryItems = 50;

/// Add, update, and delete for a single pantry item — one controller for the
/// same reason `HouseholdSettingsController` is one controller for its three
/// actions: all three are mutually exclusive by intent (no flow adds and
/// deletes the same item at once), so one in-flight action is what makes
/// "two spinners at once" unrepresentable.
///
/// Every method **never throws** and returns `true` only on success, with the
/// concrete `AppError` subtype preserved in `state.error` for the screen to
/// render. On success, [PantryController]'s cached list for the affected
/// household is invalidated — [updatePantryItem]/[deletePantryItem] carry no
/// `householdId` argument of their own, so the returned [PantryItem]'s own
/// `householdId` is what makes that invalidation possible without a second
/// round trip.
class PantryFormController extends AsyncNotifier<void> {
  PantryRepository get _repository => ref.read(pantryRepositoryProvider);

  PantryFormAction get action => _action;
  PantryFormAction _action = PantryFormAction.none;

  @override
  Future<void> build() async {}

  Future<bool> add(String householdId, PantryItemDraft draft) =>
      _run(PantryFormAction.add, () async {
        await _repository.addPantryItem(householdId, draft);
        ref.invalidate(pantryControllerProvider(householdId));
      });

  /// Commits [selections] from `CuratedItemsSheet` (W14 S5) as **one**
  /// `bulkAddPantryItems` call (E2E_MVP_PLAN.md §20.2.7 D7, §20.3 S6) —
  /// never `N` sequential [add] calls. Each [CuratedPantrySelection] maps
  /// straight to a [PantryItemDraft] carrying its own name/quantity/unit;
  /// `category` is left unset here — `CuratedPantrySelection` deliberately
  /// carries no category of its own (see that type's doc), and threading
  /// the sheet's category through `AddMethodScreen`'s already-shipped
  /// `onCuratedItemsSelected` callback would mean widening a signature S5
  /// already locked. `category` is optional on `PantryItemInput`, so this
  /// is a real simplification, not a silent correctness gap: the added
  /// items simply start uncategorized, exactly like a manually-added item
  /// with no category chip selected.
  ///
  /// **Refuses a selection over [maxBulkAddPantryItems] client-side**,
  /// before ever calling [PantryRepository.bulkAddPantryItems] — a
  /// [ValidationError] lands in `state.error` the same way a server-side
  /// `VALIDATION` failure would, so the caller's error rendering needs no
  /// special case for "refused before the network call" vs. "refused by
  /// the server". [selections] itself is never truncated or mutated either
  /// way — a caller that retries after a failure (of any kind) can resend
  /// the identical list.
  ///
  /// On success, invalidates [PantryController]'s cached list for
  /// [householdId] — the **only** way this list picks up the new items.
  /// `bulkAddPantryItems` is deliberately absent from `onPantryChanged`'s
  /// `@aws_subscribe` list (§11.2.1 decision 2), so another household
  /// member's already-open pantry screen does **not** live-update from
  /// this call; they see the new items on their own next refetch. That is
  /// a named, accepted gap (§20.2.7), not something this method works
  /// around.
  Future<bool> bulkAdd(
    String householdId,
    List<CuratedPantrySelection> selections,
  ) => _run(PantryFormAction.bulkAdd, () async {
    if (selections.length > maxBulkAddPantryItems) {
      throw ValidationError(
        'Select $maxBulkAddPantryItems items or fewer at a time.',
      );
    }
    await _repository.bulkAddPantryItems(
      householdId,
      <PantryItemDraft>[
        for (final CuratedPantrySelection selection in selections)
          PantryItemDraft(
            name: selection.name,
            quantity: selection.quantity,
            unit: selection.unit,
          ),
      ],
    );
    ref.invalidate(pantryControllerProvider(householdId));
  });

  /// Named `updateItem`, not `update` — `AsyncNotifierBase` already declares
  /// a built-in `update` (a `state`-transform helper), and this method's
  /// unrelated signature can't override it.
  Future<bool> updateItem(String id, PantryItemPatch patch) =>
      _run(PantryFormAction.update, () async {
        final PantryItem updated = await _repository.updatePantryItem(id, patch);
        ref.invalidate(pantryControllerProvider(updated.householdId));
      });

  Future<bool> delete(String id) => _run(PantryFormAction.delete, () async {
    final PantryItem deleted = await _repository.deletePantryItem(id);
    ref.invalidate(pantryControllerProvider(deleted.householdId));
  });

  /// The one place the three actions share: mark which action is running,
  /// park the outcome, report success. Identical shape to
  /// `HouseholdSettingsController._run`.
  Future<bool> _run(
    PantryFormAction action,
    Future<void> Function() body,
  ) async {
    _action = action;
    state = const AsyncLoading<void>();
    state = await AsyncValue.guard<void>(body);
    return !state.hasError;
  }
}

final AsyncNotifierProvider<PantryFormController, void>
pantryFormControllerProvider = AsyncNotifierProvider<PantryFormController, void>(
  PantryFormController.new,
);
