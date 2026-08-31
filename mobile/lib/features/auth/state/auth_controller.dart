import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/storage/app_database.dart';
import '../../household/state/me_households_controller.dart';
import '../data/auth_repository.dart';
import '../domain/auth_session.dart';

/// Owns the app's single source of truth for auth state.
///
/// Plain Riverpod, no code generation — the codebase has no build_runner step
/// and adding one for a single notifier would cost more than it saves.
///
/// Errors are not swallowed and not re-thrown to callers: `AsyncValue.guard`
/// parks the thrown [AuthFailure] in `AsyncError`, keeping the *specific*
/// subtype intact so the sign-in screen can pattern-match on it.
class AuthController extends AsyncNotifier<AuthSession> {
  AuthRepository get _repository => ref.read(authRepositoryProvider);

  // Every write to `state`, from either the Hub listener or `_run`, bumps
  // this first. `_run` is the only writer that can lose a race — a Hub event
  // (e.g. a Cognito-initiated `sessionExpired` for a reason unrelated to the
  // in-flight call) can land while `action` is still awaiting. Without this
  // guard, `_run`'s own eventual write would silently clobber that fresher,
  // externally-pushed state with a now-stale result. Comparing the
  // generation captured at the start of `_run` against the current one after
  // `await` lets it detect "something else already wrote since I started"
  // and skip its own write rather than winning a race it shouldn't win.
  int _generation = 0;

  @override
  Future<AuthSession> build() async {
    final AuthRepository repository = ref.watch(authRepositoryProvider);

    final StreamSubscription<AuthSession> subscription = repository
        .sessionChanges()
        .listen(
          (AuthSession session) => _write(AsyncData<AuthSession>(session)),
          onError: (Object error, StackTrace stackTrace) =>
              _write(AsyncError<AuthSession>(error, stackTrace)),
        );
    ref.onDispose(subscription.cancel);

    return repository.currentSession();
  }

  void _write(AsyncValue<AuthSession> next) {
    _generation++;
    state = next;
  }

  /// Opens the Cognito Hosted UI. Never throws — inspect `state` afterwards.
  Future<void> signInWithGoogle() => _run(() => _repository.signInWithGoogle());

  /// Signs out locally and remotely. Never throws.
  ///
  /// Also evicts the entire pantry read cache (W5 S7) and invalidates
  /// [meHouseholdsControllerProvider] (W8 S1) — a household's pantry, or its
  /// membership list, surviving sign-out on a shared family phone would let
  /// the next person to sign in read the previous user's data straight off
  /// disk or out of a still-cached provider, before ever making a network
  /// request of their own. The pantry cache is cleared unconditionally
  /// (`clearAll`, not scoped to one household) since [signOut] has no
  /// reliable "whose data was this" to scope narrower than that;
  /// `meHouseholdsControllerProvider` is invalidated rather than cleared —
  /// `AsyncNotifier` has no "empty" state of its own, and `app/router.dart`'s
  /// `_redirect` needs the *next* signed-in read to be a real, freshly-fetched
  /// answer for whichever user just signed in, not a stale value belonging to
  /// whoever signed out.
  ///
  /// The cache clear/invalidation is deliberately isolated from
  /// `_repository.signOut()`'s own error handling: `_run` treats any thrown
  /// error as "signOut failed," which routes through `copyWithPrevious` and
  /// leaves `state.valueOrNull` at the *previous, signed-in* session —
  /// `app/router.dart`'s redirect gate reads exactly that. A local-storage
  /// failure here must not masquerade as a failed account sign-out and strand
  /// the router believing the user is still authenticated after Cognito has
  /// already signed them out.
  Future<void> signOut() => _run(() async {
    await _repository.signOut();
    try {
      await ref.read(appDatabaseProvider).pantryDao.clearAll();
    } on Object {
      // Best-effort — see the method doc above.
    }
    ref.invalidate(meHouseholdsControllerProvider);
    return const AuthSession.signedOut();
  });

  Future<void> _run(Future<AuthSession> Function() action) async {
    final int startedAt = ++_generation;
    // `copyWithPrevious` keeps the last good session visible underneath the
    // spinner, so the router does not bounce the user out of /home mid-call.
    state = const AsyncLoading<AuthSession>().copyWithPrevious(state);
    final AsyncValue<AuthSession> result = await AsyncValue.guard(action);
    // If `_generation` has moved on, a Hub event wrote a fresher state while
    // `action` was in flight — that write is more current than this call's
    // own result, so don't overwrite it. See the field doc above.
    if (_generation == startedAt) {
      _generation++;
      state = result;
    }
  }
}

final AsyncNotifierProvider<AuthController, AuthSession>
authControllerProvider = AsyncNotifierProvider<AuthController, AuthSession>(
  AuthController.new,
);
