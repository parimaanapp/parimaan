import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/household_repository.dart';
import '../domain/household.dart';

/// Owns the state of the "create a household" action.
///
/// Same shape as `AuthController`, for the same reasons: plain Riverpod with
/// no code generation, and `AsyncValue.guard` to park a thrown error in
/// `AsyncError` **with its concrete type intact**. That last part is the whole
/// point — the first-run screen pattern-matches the `AppError` subtype out of
/// `state.error`, so collapsing everything to a generic "something went wrong"
/// here would throw away the only thing that makes a `RATE_LIMITED` message
/// different from a `VALIDATION` one.
///
/// The state is `Household?`, not `Household`: `null` is the honest starting
/// value — nothing has been created yet — and modelling "idle" as an
/// `AsyncData(null)` keeps `isLoading` meaning exactly "a create is in
/// flight", which is what the button binds to.
class CreateHouseholdController extends AsyncNotifier<Household?> {
  /// `read`, not `watch`: the repository is resolved when an action runs, so
  /// simply building this notifier never touches the GraphQL client. That is
  /// what lets the first-run screen render (and the router settle on it) in a
  /// test with no client override at all.
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  @override
  Future<Household?> build() async => null;

  /// Creates a household and leaves the outcome in `state`.
  ///
  /// **Never throws.** Callers await it and then inspect `state`, matching
  /// `AuthController.signInWithGoogle`.
  ///
  /// No client-side validation happens here. The screen validates for fast
  /// feedback before calling; see `domain/household_name.dart` for why that
  /// belongs there and not in this path.
  Future<void> createHousehold(String name) async {
    // Not `copyWithPrevious`: unlike auth, there is no previously-good value
    // worth keeping visible underneath the spinner, and carrying the old error
    // forward would leave a stale message on screen during the retry.
    state = const AsyncLoading<Household?>();
    state = await AsyncValue.guard<Household?>(
      () => _repository.createHousehold(name),
    );
  }
}

final AsyncNotifierProvider<CreateHouseholdController, Household?>
createHouseholdControllerProvider =
    AsyncNotifierProvider<CreateHouseholdController, Household?>(
      CreateHouseholdController.new,
    );
