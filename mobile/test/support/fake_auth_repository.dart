import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mocktail/mocktail.dart';

/// mocktail double for [AuthRepository].
///
/// Every test in this package drives auth through this — no test ever reaches
/// `AmplifyAuthRepository`, which needs platform channels that do not exist in
/// the `flutter_test` environment.
class MockAuthRepository extends Mock implements AuthRepository {}

/// A [MockAuthRepository] already stubbed for the common "cold start" shape:
/// [AuthRepository.currentSession] resolves to [session] and
/// [AuthRepository.sessionChanges] never emits.
///
/// Individual tests re-stub whichever method they are actually exercising.
MockAuthRepository stubbedAuthRepository({
  AuthSession session = const AuthSession.signedOut(),
}) {
  final MockAuthRepository repository = MockAuthRepository();
  when(repository.currentSession).thenAnswer((_) async => session);
  when(repository.sessionChanges)
      .thenAnswer((_) => const Stream<AuthSession>.empty());
  when(repository.signOut).thenAnswer((_) async {});
  when(repository.currentIdToken)
      .thenAnswer((_) async => session.isSignedIn ? testIdToken : null);
  return repository;
}

/// The id token `stubbedAuthRepository` hands back for a signed-in session.
/// Not a real JWT — nothing in the app parses it; it is passed straight to the
/// `Authorization` header.
const String testIdToken = 'test-id-token';

/// The signed-in session used across tests, so assertions stay comparable.
const AuthSession testSignedInSession = AuthSession.signedIn(
  userId: 'user-1',
  email: 'asha@example.com',
  displayName: 'Asha',
);
