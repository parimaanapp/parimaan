import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/household_repository.dart';

/// The signed-in caller's own `users.id`, via `Query.me`.
///
/// **Not the same value as `authControllerProvider`'s `AuthSession.userId`.**
/// That one is Amplify's `AuthUser.userId` — the Cognito sub. This is the
/// server's internal `users.id`, the value `Household.primaryUserId` and
/// every `User.id` in a GraphQL response actually carry. Anything comparing
/// the caller against a household's `primaryUserId` (or any other `User.id`)
/// must read this provider, not `authControllerProvider` — comparing the sub
/// against `primaryUserId` compares two different ID spaces and is
/// essentially never equal. See [HouseholdRepository.fetchMyUserId]'s doc for
/// the concrete bug this fixes: a household's real primary member saw "Leave
/// household" instead of "Delete household" in the Settings hub, because
/// `isPrimary` had nothing but the sub to compare with.
///
/// A plain `FutureProvider`, not an `AsyncNotifier`: this value cannot change
/// for the lifetime of a signed-in session (a `users.id` is immutable once
/// provisioned), so there is nothing to `refresh()`. `AuthController.signOut`
/// invalidates it like every other household-scoped provider, so the next
/// sign-in gets a fresh caller identity rather than the previous session's.
final FutureProvider<String> currentUserIdControllerProvider =
    FutureProvider<String>(
      (Ref ref) => ref.read(householdRepositoryProvider).fetchMyUserId(),
    );
