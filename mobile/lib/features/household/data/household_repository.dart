import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/create_household.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_household.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_household.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_household.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_household.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_household.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/household.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/household.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/household.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/join_household.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/join_household.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/join_household.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/leave_household.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/leave_household.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/leave_household.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/rotate_invite_code.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/rotate_invite_code.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/rotate_invite_code.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_household_settings.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_household_settings.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_household_settings.var.gql.dart';
import '../domain/household.dart';
import '../domain/household_settings_patch.dart';
import '../domain/invite_code.dart';
import 'household_mapper.dart';

/// The app's household surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of [AppError] and nothing
/// else — no `GraphQLError`, no `LinkException`, no `built_value`
/// deserialization failure. Same contract, and same rationale, as
/// `AuthRepository`'s with `AuthFailure`.
///
/// The whole household surface is now here: create, join, read, settings,
/// rotate, leave, delete. Nothing in `shared/schema.graphql`'s household area
/// is left unimplemented on the client.
abstract interface class HouseholdRepository {
  /// Creates a household named [name] with the caller as its `primary` member,
  /// and returns it fully populated (settings + members).
  ///
  /// [name] is trimmed before being sent, mirroring the server's own
  /// `.trim()`. It is **not** otherwise pre-validated here — see
  /// `domain/household_name.dart` for why client validation is a presentation
  /// concern and never a substitute for the round trip.
  Future<Household> createHousehold(String name);

  /// Applies [patch] to the settings of [householdId] and returns the
  /// household's **whole** settings row — not just the patched fields, which
  /// is what `Mutation.updateHouseholdSettings` returns.
  ///
  /// The patch is partial by construction: a `null` field on
  /// [HouseholdSettingsPatch] is omitted from the request entirely, leaving
  /// that column unchanged. See that type's doc for why `null`-means-absent is
  /// sufficient here and a sentinel is not.
  ///
  /// Requires the caller to already be a member of [householdId]; a non-member
  /// gets [ForbiddenError].
  Future<HouseholdSettings> updateHouseholdSettings(
    String householdId,
    HouseholdSettingsPatch patch,
  );

  /// Joins the caller to the household whose invite code is [inviteCode], as a
  /// `member`, and returns it fully populated.
  ///
  /// [inviteCode] is trimmed and uppercased before being sent, mirroring the
  /// server's own `.trim().toUpperCase()`. It is **not** otherwise
  /// pre-validated here — see `domain/invite_code.dart` for why client
  /// validation is a presentation concern.
  ///
  /// Idempotent: re-joining a household the caller already belongs to
  /// succeeds and returns the same household.
  ///
  /// Three failures matter to the UI and are distinguishable by subtype:
  /// [HouseholdFullError] (the 5-member cap), [NotFoundError] (no household
  /// has that code) and [RateLimitedError] (too many guesses today).
  Future<Household> joinHousehold(String inviteCode);

  /// Reads one household, fully hydrated with its settings and every member.
  ///
  /// **Always goes to the network**, never to ferry's cache — this is what
  /// `HouseholdSyncPolicy`'s poll and every refetch-on-entry call, and a poll
  /// answered from cache is not a poll. See the implementation for the
  /// `FetchPolicy` that enforces it.
  ///
  /// A non-member and a nonexistent [householdId] both raise the identical
  /// [ForbiddenError], so this is never an existence oracle.
  Future<Household> fetchHousehold(String householdId);

  /// Replaces [householdId]'s invite code with a freshly-generated one and
  /// returns the updated household.
  ///
  /// **Not idempotent**: each success invalidates the previous code for
  /// everyone already holding it. Any member may rotate; the caller must
  /// already be a member ([ForbiddenError] otherwise), and the server
  /// rate-limits this more tightly than [joinHousehold].
  Future<Household> rotateInviteCode(String householdId);

  /// Removes the caller's own membership from [householdId].
  ///
  /// Idempotent, and deliberately un-gated server-side: a caller who is not
  /// (or is no longer) a member gets `true`, not a denial, because that is the
  /// state this asks for. A nonexistent [householdId] is indistinguishable
  /// from that and equally successful — so a `true` here means "you are not a
  /// member of that household", not "a membership row was deleted".
  ///
  /// The **primary** cannot leave: that is a [ForbiddenError]. The Settings
  /// hub does not offer the affordance to a primary at all rather than
  /// offering an action guaranteed to fail.
  Future<bool> leaveHousehold(String householdId);

  /// Permanently deletes [householdId]. Primary-only, irreversible.
  ///
  /// [confirmationName] is sent **byte-for-byte as given** — no trim, no case
  /// folding. The server compares it with `!==` against the stored name, so
  /// normalizing here could either mangle a legitimate exact-match attempt
  /// into a mismatch or, worse, turn a genuine mismatch into a match the user
  /// never actually typed. For an irreversible operation that second failure
  /// mode is unacceptable, which is why this method does nothing to its
  /// argument.
  ///
  /// A non-primary member and a non-member both get [ForbiddenError]; a
  /// mismatched name gets [ValidationError] and deletes nothing.
  Future<bool> deleteHousehold(String householdId, String confirmationName);
}

/// Ferry-backed [HouseholdRepository].
///
/// The only file besides `household_mapper.dart` that touches generated
/// GraphQL types.
class FerryHouseholdRepository implements HouseholdRepository {
  const FerryHouseholdRepository({required this.client});

  final Client client;

  @override
  Future<Household> createHousehold(String name) async {
    final GCreateHouseholdReq request = GCreateHouseholdReq(
      (GCreateHouseholdReqBuilder b) =>
          b..vars = (GCreateHouseholdVarsBuilder()..name = name.trim()),
    );

    final GCreateHouseholdData data = await _execute(request);
    return householdFromGraphQL(data.createHousehold);
  }

  @override
  Future<HouseholdSettings> updateHouseholdSettings(
    String householdId,
    HouseholdSettingsPatch patch,
  ) async {
    final GUpdateHouseholdSettingsReq request = GUpdateHouseholdSettingsReq(
      (GUpdateHouseholdSettingsReqBuilder b) =>
          b
            ..vars = (GUpdateHouseholdSettingsVarsBuilder()
              ..householdId = householdId
              ..input = householdSettingsInputFromPatch(patch).toBuilder()),
    );

    final GUpdateHouseholdSettingsData data = await _execute(request);
    return householdSettingsFromGraphQL(data.updateHouseholdSettings);
  }

  @override
  Future<Household> joinHousehold(String inviteCode) async {
    final GJoinHouseholdReq request = GJoinHouseholdReq(
      (GJoinHouseholdReqBuilder b) =>
          b
            ..vars = (GJoinHouseholdVarsBuilder()
              ..inviteCode = normalizeInviteCode(inviteCode)),
    );

    final GJoinHouseholdData data = await _execute(request);
    return householdFromGraphQL(data.joinHousehold);
  }

  /// See [HouseholdRepository.fetchHousehold] for the contract.
  ///
  /// `fetchPolicy: FetchPolicy.NoCache` is the load-bearing part. Ferry's
  /// default for a query is `CacheFirst`, which would answer the second and
  /// every subsequent call from the normalised cache without touching the
  /// network — turning `HouseholdSyncPolicy`'s 15-second poll into a 15-second
  /// re-read of a value that can never change. `NoCache` rather than
  /// `NetworkOnly` because this response is deliberately **not** written back
  /// into the cache either: cache invalidation across household-scoped screens
  /// is explicitly W12's problem once real subscriptions land, and a poll that
  /// silently rewrites shared cache entries underneath other screens is
  /// exactly the coupling this slice is scoped to avoid.
  @override
  Future<Household> fetchHousehold(String householdId) async {
    final GHouseholdReq request = GHouseholdReq(
      (GHouseholdReqBuilder b) => b
        ..vars = (GHouseholdVarsBuilder()..householdId = householdId)
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GHouseholdData data = await _execute(request);
    return householdFromGraphQL(data.household);
  }

  @override
  Future<Household> rotateInviteCode(String householdId) async {
    final GRotateInviteCodeReq request = GRotateInviteCodeReq(
      (GRotateInviteCodeReqBuilder b) =>
          b..vars = (GRotateInviteCodeVarsBuilder()..householdId = householdId),
    );

    final GRotateInviteCodeData data = await _execute(request);
    return householdFromGraphQL(data.rotateInviteCode);
  }

  @override
  Future<bool> leaveHousehold(String householdId) async {
    final GLeaveHouseholdReq request = GLeaveHouseholdReq(
      (GLeaveHouseholdReqBuilder b) =>
          b..vars = (GLeaveHouseholdVarsBuilder()..householdId = householdId),
    );

    final GLeaveHouseholdData data = await _execute(request);
    return data.leaveHousehold;
  }

  /// See [HouseholdRepository.deleteHousehold] — [confirmationName] is passed
  /// through untouched, deliberately.
  @override
  Future<bool> deleteHousehold(
    String householdId,
    String confirmationName,
  ) async {
    final GDeleteHouseholdReq request = GDeleteHouseholdReq(
      (GDeleteHouseholdReqBuilder b) => b
        ..vars = (GDeleteHouseholdVarsBuilder()
          ..householdId = householdId
          ..confirmationName = confirmationName),
    );

    final GDeleteHouseholdData data = await _execute(request);
    return data.deleteHousehold;
  }

  /// Runs one operation and reduces ferry's stream-of-responses to a single
  /// value or a single [AppError].
  ///
  /// Takes the first *settled* response rather than `stream.first`: ferry
  /// emits a placeholder response (no data, no errors) before the network
  /// result for some fetch policies, and `first` would treat that as the
  /// answer.
  ///
  /// "Settled" is spelled out here rather than using ferry's own
  /// `response.loading`, which is `linkException == null && data == null` — so
  /// a **failed** GraphQL response (`data: null` plus an `errors` array, which
  /// is exactly what AppSync returns when a non-nullable root field throws)
  /// reads as still-loading and would hang forever.
  Future<TData> _execute<TData, TVars>(
    OperationRequest<TData, TVars> request,
  ) async {
    OperationResponse<TData, TVars>? settled;
    await for (final OperationResponse<TData, TVars> response in client.request(
      request,
    )) {
      if (response.data != null || response.hasErrors) {
        settled = response;
        break;
      }
    }

    // The stream ended without ever settling. Not expected, but returning
    // null or letting a `StateError` escape would both break the "throws only
    // AppError" contract.
    if (settled == null) {
      throw const InternalError(genericErrorMessage);
    }

    final TData? data = settled.data;
    if (settled.hasErrors || data == null) {
      throw mapOperationFailure(
        graphqlErrors: settled.graphqlErrors,
        linkException: settled.linkException,
      );
    }
    return data;
  }
}

/// Injection point for [HouseholdRepository].
///
/// Defaults to the real Ferry implementation over [ferryClientProvider] —
/// unlike `authRepositoryProvider`, which cannot have a default because its
/// implementation needs an `AppConfig`. Here the environment-specific part is
/// already encapsulated by the client provider, so this one composes rather
/// than throwing, and a test overrides either this or the client beneath it.
final Provider<HouseholdRepository> householdRepositoryProvider =
    Provider<HouseholdRepository>(
      (Ref ref) =>
          FerryHouseholdRepository(client: ref.watch(ferryClientProvider)),
    );
