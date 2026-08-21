import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/household_repository.dart';
import '../domain/household.dart';
import 'household_wizard_controller.dart';
import 'join_household_controller.dart';

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

/// The household this session is working with, if any — a **stopgap**.
///
/// ## Why this is not a real answer
///
/// The right source for "which household does this user belong to" is
/// `Query.me`, whose `households` field exists in the schema and in
/// `me.graphql`, but which no controller reads yet — `router.dart`'s redirect
/// says the same thing about its own unconditional first-run bounce. Until a
/// `me` controller lands, the only households this app knows about are the ones
/// it just watched the user create or join, in this session, in memory.
///
/// So that is exactly what this reports, and nothing more: the wizard's created
/// household, else the join flow's joined household, else `null`. It is
/// deliberately **not** persisted and deliberately not fetched — inventing a
/// local cache of household membership now would be a second source of truth to
/// reconcile against `Query.me` the moment that lands.
///
/// The visible consequence is honest and temporary: a returning user who
/// restarts the app has no active household until they create or join one
/// again, so Settings and Members are unreachable from a cold start. The slice
/// that adds a `me` controller should replace this provider's body outright
/// rather than layering another fallback onto it.
final Provider<Household?> activeHouseholdProvider = Provider<Household?>((
  Ref ref,
) {
  final Household? joined = ref
      .watch(joinHouseholdControllerProvider)
      .valueOrNull;
  if (joined != null) {
    return joined;
  }
  return ref.watch(householdWizardControllerProvider).valueOrNull?.household;
});
