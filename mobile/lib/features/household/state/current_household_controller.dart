import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/household_repository.dart';
import '../domain/household.dart';
import 'household_wizard_controller.dart';
import 'join_household_controller.dart';
import 'me_households_controller.dart';

/// The server-backed read of one household, keyed by its id.
///
/// This is what the Settings hub and the Members list render, and what
/// `HouseholdSyncPolicy` refreshes. It is a *family* rather than a single
/// provider because a household id is the only sensible key: a user in two
/// households must be able to have both cached independently, and keying on
/// "whichever household is on screen" would make the two overwrite each other.
///
/// `build` calls `fetchHousehold`, which is `FetchPolicy.NoCache` — so every
/// first read and every [refresh] genuinely hits the network. See
/// `HouseholdRepository.fetchHousehold` for why a cached poll is not a poll.
class CurrentHouseholdController
    extends FamilyAsyncNotifier<Household, String> {
  /// `read`, not `watch` — consistent with every other controller here.
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  @override
  Future<Household> build(String householdId) =>
      _repository.fetchHousehold(householdId);

  /// Re-reads the household from the server.
  ///
  /// **Never throws** — the outcome lands in `state`, matching every other
  /// controller in this feature. That matters more here than elsewhere:
  /// `HouseholdSyncPolicy` calls this from a `Timer`, where an escaping
  /// exception would surface as an unhandled async error rather than as
  /// anything a user could act on.
  ///
  /// Loading and error states are built with `copyWithPrevious`, so a poll
  /// that fails leaves the last good roster on screen instead of blanking a
  /// screen the user is reading. A background refresh that wipes the content
  /// it was refreshing is worse than one that quietly fails.
  Future<void> refresh() async {
    final AsyncValue<Household> previous = state;
    state = const AsyncLoading<Household>().copyWithPrevious(previous);

    final AsyncValue<Household> result = await AsyncValue.guard<Household>(
      () => _repository.fetchHousehold(arg),
    );

    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }
}

final AsyncNotifierProviderFamily<CurrentHouseholdController, Household, String>
currentHouseholdControllerProvider =
    AsyncNotifierProvider.family<CurrentHouseholdController, Household, String>(
      CurrentHouseholdController.new,
    );

/// The household this session is working with, if any.
///
/// ## Two tiers, not a stopgap layered onto a stopgap
///
/// This used to report only what the wizard or join flow had just done *in
/// memory, this session* — there was no other source, because nothing read
/// `Query.me`. [MeHouseholdsController] is that source now, so this provider's
/// body is the real answer: the session's own just-created or just-joined
/// household when there is one (an immediate, round-trip-free answer for the
/// screen the user is already on), falling through to the server's list of
/// every household this user belongs to (what makes Settings and Members
/// reachable again after an app restart, which the old session-only version
/// could never do).
///
/// The session-scoped checks stay first rather than being deleted now that a
/// real source exists, because they answer a question `Query.me` cannot:
/// immediately after a create or join succeeds, [MeHouseholdsController] has
/// not refetched (see its own doc for why it does not need to push itself),
/// so it would still show *last* launch's list for the rest of this session.
/// The household just created or joined is the obviously-correct answer in
/// that moment, and asking the server to confirm what it was just told would
/// be pure latency.
///
/// [MeHouseholdsController.build] fetches every household this user belongs
/// to; this provider takes the first. Multiple households per user is real in
/// the schema but not yet a chosen-household concept anywhere in the product,
/// so "first" is the only order-independent answer available until a real
/// household switcher exists.
final Provider<Household?> activeHouseholdProvider = Provider<Household?>((
  Ref ref,
) {
  final Household? joined = ref
      .watch(joinHouseholdControllerProvider)
      .valueOrNull;
  if (joined != null) {
    return joined;
  }

  final Household? created = ref
      .watch(householdWizardControllerProvider)
      .valueOrNull
      ?.household;
  if (created != null) {
    return created;
  }

  final List<Household>? households = ref
      .watch(meHouseholdsControllerProvider)
      .valueOrNull;
  return households == null || households.isEmpty ? null : households.first;
});
