import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/create_household.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_household.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_household.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_household_settings.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_household_settings.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_household_settings.var.gql.dart';
import '../domain/household.dart';
import '../domain/household_settings_patch.dart';
import 'household_mapper.dart';

/// The app's household surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of [AppError] and nothing
/// else — no `GraphQLError`, no `LinkException`, no `built_value`
/// deserialization failure. Same contract, and same rationale, as
/// `AuthRepository`'s with `AuthFailure`.
///
/// `createHousehold` and `updateHouseholdSettings` exist so far.
/// `joinHousehold`, `rotateInviteCode`, `leaveHousehold` and `deleteHousehold`
/// are all implemented server-side already, but each needs its own operation
/// document, mapping and tests, and adding stubs for them now would be four
/// untested methods pretending to be a finished interface.
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
