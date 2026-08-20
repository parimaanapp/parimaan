import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

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

  @override
  Future<AuthSession> build() async {
    final AuthRepository repository = ref.watch(authRepositoryProvider);

    final StreamSubscription<AuthSession> subscription = repository
        .sessionChanges()
        .listen(
          (AuthSession session) => state = AsyncData<AuthSession>(session),
          onError: (Object error, StackTrace stackTrace) =>
              state = AsyncError<AuthSession>(error, stackTrace),
        );
    ref.onDispose(subscription.cancel);

    return repository.currentSession();
  }

  /// Opens the Cognito Hosted UI. Never throws — inspect `state` afterwards.
  Future<void> signInWithGoogle() => _run(() => _repository.signInWithGoogle());

  /// Signs out locally and remotely. Never throws.
  Future<void> signOut() => _run(() async {
    await _repository.signOut();
    return const AuthSession.signedOut();
  });

  Future<void> _run(Future<AuthSession> Function() action) async {
    // `copyWithPrevious` keeps the last good session visible underneath the
    // spinner, so the router does not bounce the user out of /home mid-call.
    state = const AsyncLoading<AuthSession>().copyWithPrevious(state);
    state = await AsyncValue.guard(action);
  }
}

final AsyncNotifierProvider<AuthController, AuthSession>
authControllerProvider = AsyncNotifierProvider<AuthController, AuthSession>(
  AuthController.new,
);
