import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/pantry.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/pantry.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/pantry.var.gql.dart';
import '../domain/pantry_item.dart';
import 'pantry_mapper.dart';

/// The app's pantry read surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of [AppError] and
/// nothing else — same contract as `HouseholdRepository`. Write operations
/// (`addPantryItem`, etc.) are S6, not this interface.
abstract interface class PantryRepository {
  /// Reads [householdId]'s pantry items, optionally filtered by a case-
  /// insensitive substring [search] against `name` and/or an exact
  /// [category] match — both applied server-side (see
  /// `api/src/repositories/pantryRepository.ts`), not by this client
  /// filtering an already-fetched list.
  ///
  /// Requires the caller to already be a member of [householdId]; a
  /// non-member gets [ForbiddenError], identically to a nonexistent id.
  Future<List<PantryItem>> fetchPantry(
    String householdId, {
    String? search,
    String? category,
  });
}

/// Ferry-backed [PantryRepository].
///
/// The only file besides `pantry_mapper.dart` that touches generated
/// GraphQL types — same boundary rule as `FerryHouseholdRepository`.
class FerryPantryRepository implements PantryRepository {
  const FerryPantryRepository({required this.client});

  final Client client;

  @override
  Future<List<PantryItem>> fetchPantry(
    String householdId, {
    String? search,
    String? category,
  }) async {
    final GPantryReq request = GPantryReq(
      (GPantryReqBuilder b) => b
        ..vars = (GPantryVarsBuilder()
          ..householdId = householdId
          ..search = search
          ..category = category)
        // Same `FetchPolicy.NoCache` reasoning as `fetchHousehold`: this
        // slice has no subscription yet, so a cached answer to a search/
        // category change would be a stale one, and cache invalidation
        // across pantry-scoped screens is explicitly out of scope until a
        // later slice.
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GPantryData data = await _execute(request);
    return data.pantry.map(pantryItemFromGraphQL).toList(growable: false);
  }

  /// Identical reduction to `FerryHouseholdRepository._execute` — see that
  /// method's doc for why "first settled response", not `stream.first`.
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

/// Injection point for [PantryRepository] — same composition-over-throwing
/// shape as `householdRepositoryProvider`.
final Provider<PantryRepository> pantryRepositoryProvider =
    Provider<PantryRepository>(
      (Ref ref) => FerryPantryRepository(client: ref.watch(ferryClientProvider)),
    );
