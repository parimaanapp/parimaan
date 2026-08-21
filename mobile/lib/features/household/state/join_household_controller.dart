import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../data/household_repository.dart';
import '../domain/household.dart';

/// What the Enter-code screen does next, after a join attempt.
///
/// This exists because exactly one failure in the whole taxonomy gets its own
/// screen (wireframe 3.3), and the call site should not have to know *which*
/// `AppError` subtype that is. Returning a three-valued outcome puts the
/// routing decision in the controller — where the error type already lives —
/// rather than making every screen re-derive it with an `is HouseholdFullError`
/// check that a fourth screen would eventually get wrong.
enum JoinOutcome {
  /// The caller is now a member. `state` holds the household.
  joined,

  /// The 5-member cap. Routes to the Full · notify-primary screen.
  householdFull,

  /// Everything else. The Enter-code screen renders `state.error`'s message
  /// inline and the user stays put to correct the code or retry.
  failed,
}

/// Owns the "join a household by invite code" action.
///
/// Same shape and same reasoning as `CreateHouseholdController`: plain
/// Riverpod, `AsyncValue.guard` so the concrete `AppError` subtype survives
/// into `state.error`, and a `Household?` state whose `null` is the honest
/// "nothing joined yet".
///
/// ## Why this is separate from `HouseholdSettingsController`
///
/// Joining is the one household action taken from *outside* a household — the
/// caller is not a member when it starts, and there is no household id to key
/// anything on, only a code. Every method on the settings controller takes a
/// `householdId` the caller already belongs to. Merging them would produce a
/// controller whose preconditions differ per method, which is exactly the
/// distinction the two types are drawing.
class JoinHouseholdController extends AsyncNotifier<Household?> {
  /// `read`, not `watch` — building this notifier must not construct a GraphQL
  /// client, so the Enter-code screen can be pumped with no client override.
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  @override
  Future<Household?> build() async => null;

  /// Attempts to join with [inviteCode], parking the outcome in `state`.
  ///
  /// **Never throws.** The return value is the routing decision; `state` is
  /// what the screen renders.
  ///
  /// [inviteCode] is passed through **unnormalized**: `FerryHouseholdRepository`
  /// already trims and uppercases it, mirroring the server's Zod chain, and a
  /// second normalization here could only ever drift from that one.
  Future<JoinOutcome> join(String inviteCode) async {
    // Not `copyWithPrevious`: a retry must not leave the previous attempt's
    // error on screen underneath the spinner, and there is no previously-joined
    // household worth keeping visible during a second attempt.
    state = const AsyncLoading<Household?>();
    state = await AsyncValue.guard<Household?>(
      () => _repository.joinHousehold(inviteCode),
    );

    final Object? error = state.error;
    if (error == null) {
      return JoinOutcome.joined;
    }
    return error is HouseholdFullError
        ? JoinOutcome.householdFull
        : JoinOutcome.failed;
  }

  /// Forgets the last attempt, returning the controller to idle.
  ///
  /// Called when the user backs out of the confirm screen, so re-entering the
  /// join flow does not open on a stale household or a stale error.
  void reset() => state = const AsyncData<Household?>(null);
}

final AsyncNotifierProvider<JoinHouseholdController, Household?>
joinHouseholdControllerProvider =
    AsyncNotifierProvider<JoinHouseholdController, Household?>(
      JoinHouseholdController.new,
    );
