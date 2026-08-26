import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/pantry_repository.dart';
import '../domain/pantry_item.dart';
import '../domain/pantry_item_draft.dart';
import '../domain/pantry_item_patch.dart';
import 'pantry_controller.dart';

/// Which action last ran, so Manual Add and the delete dialog can each show
/// their own spinner without one lighting up the other — same reasoning as
/// `HouseholdSettingsController`'s `HouseholdSettingsAction`.
enum PantryFormAction { none, add, update, delete }

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
