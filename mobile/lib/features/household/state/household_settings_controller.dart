import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/household_repository.dart';
import '../domain/household.dart';
import 'current_household_controller.dart';

/// Which destructive/administrative action last ran, so the Settings hub can
/// put a spinner on the right row.
///
/// Without this a single `isLoading` would light up every row at once, and the
/// user could not tell whether they had started a rotate or a delete — an
/// unacceptable ambiguity when one of the three is irreversible.
enum HouseholdSettingsAction { none, rotateInviteCode, leave, delete }

/// The Settings hub's three server actions: rotate the invite code, leave the
/// household, delete the household.
///
/// ## Why one controller and not three
///
/// All three are invoked from the same screen, act on the same household, and
/// are **mutually exclusive by intent** — there is no sane flow where a rotate
/// and a delete are in flight together. Three separate notifiers would each
/// carry their own independent `isLoading`, which is precisely the state that
/// lets a screen render two spinners at once and lets a user tap "Delete" while
/// a "Leave" is still resolving. One controller with one in-flight action makes
/// that unrepresentable, and [action] keeps the per-row spinner honest.
///
/// The join flow stays in its own controller for the opposite reason — see
/// `JoinHouseholdController`'s doc: its caller is not yet a member, so it
/// shares neither the precondition nor the household id these three share.
///
/// ## Contract
///
/// Every method **never throws** and returns `true` only on success, matching
/// the rest of this feature. The concrete `AppError` subtype is preserved in
/// `state.error` so the screen can render the server's own message — the
/// difference between "Only the primary member can delete a household" and
/// "confirmationName must exactly match the household name" is the entire
/// value of the message.
class HouseholdSettingsController extends AsyncNotifier<void> {
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  /// The action currently in flight, or the last one that ran.
  HouseholdSettingsAction get action => _action;
  HouseholdSettingsAction _action = HouseholdSettingsAction.none;

  @override
  Future<void> build() async {}

  /// Replaces [householdId]'s invite code.
  ///
  /// On success the server's updated household is pushed straight into
  /// [currentHouseholdControllerProvider] rather than triggering a refetch:
  /// `rotateInviteCode` already returns the whole household (that is why the
  /// operation selects `...HouseholdFields`), so a follow-up read would be a
  /// second round trip for data already in hand — and a window in which the
  /// screen shows the *old* code after the user watched it change.
  Future<bool> rotateInviteCode(String householdId) => _run(
    HouseholdSettingsAction.rotateInviteCode,
    () async {
      final Household rotated = await _repository.rotateInviteCode(householdId);
      ref.read(currentHouseholdControllerProvider(householdId).notifier).state =
          AsyncData<Household>(rotated);
    },
  );

  /// Removes the caller's own membership.
  ///
  /// The primary cannot leave — that is a `ForbiddenError`. The Settings hub
  /// does not render the row at all for a primary, so reaching this as one
  /// should be impossible; the server check is still the authority and its
  /// message is still rendered if it ever fires.
  Future<bool> leaveHousehold(String householdId) =>
      _run(HouseholdSettingsAction.leave, () async {
        await _repository.leaveHousehold(householdId);
      });

  /// Permanently deletes [householdId]. Primary-only, irreversible.
  ///
  /// [confirmationName] is forwarded **byte-for-byte**. Nothing on the path
  /// from the text field to the wire trims or case-folds it — see
  /// `HouseholdRepository.deleteHousehold` for why normalizing an irreversible
  /// operation's confirmation is the one thing this flow must never do.
  Future<bool> deleteHousehold(String householdId, String confirmationName) =>
      _run(HouseholdSettingsAction.delete, () async {
        await _repository.deleteHousehold(householdId, confirmationName);
      });

  /// The one place the three actions share: mark which action is running, park
  /// the outcome, report success.
  Future<bool> _run(
    HouseholdSettingsAction action,
    Future<void> Function() body,
  ) async {
    _action = action;
    // Not `copyWithPrevious`: `state` here carries no value worth preserving
    // (it is `void`), and carrying the previous *error* forward would leave a
    // failed leave's message on screen during a retry.
    state = const AsyncLoading<void>();
    state = await AsyncValue.guard<void>(body);
    return !state.hasError;
  }
}

final AsyncNotifierProvider<HouseholdSettingsController, void>
householdSettingsControllerProvider =
    AsyncNotifierProvider<HouseholdSettingsController, void>(
      HouseholdSettingsController.new,
    );
