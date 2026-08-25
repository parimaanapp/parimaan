import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/household_repository.dart';
import '../domain/household.dart';

/// Every household the signed-in caller belongs to, via `Query.me`.
///
/// This is the real answer to "which households does this user have" —
/// [activeHouseholdProvider] reads it as its non-session-scoped fallback. See
/// that provider's doc for the full picture of how the two combine.
///
/// `build` fetches once per app run (Riverpod's default `AsyncNotifier`
/// caching) rather than polling: unlike `CurrentHouseholdController`, nothing
/// here needs to notice a co-member's change in real time — it only answers
/// "does *this* signed-in user have a household to land on", and a create or
/// join within the current session is already visible without a refetch via
/// [activeHouseholdProvider]'s session-scoped fallbacks. What this list picks
/// up freshly is the *next* app launch: `Query.me` is server-truth, and the
/// creating/joining mutation has already persisted by the time this session
/// ends, so there is nothing for those actions to push here proactively.
class MeHouseholdsController extends AsyncNotifier<List<Household>> {
  /// `read`, not `watch` — consistent with every other controller here.
  HouseholdRepository get _repository => ref.read(householdRepositoryProvider);

  @override
  Future<List<Household>> build() => _repository.fetchMyHouseholds();

  /// Re-reads from the server.
  Future<void> refresh() async {
    state = const AsyncLoading<List<Household>>();
    state = await AsyncValue.guard<List<Household>>(
      () => _repository.fetchMyHouseholds(),
    );
  }
}

final AsyncNotifierProvider<MeHouseholdsController, List<Household>>
meHouseholdsControllerProvider =
    AsyncNotifierProvider<MeHouseholdsController, List<Household>>(
      MeHouseholdsController.new,
    );
