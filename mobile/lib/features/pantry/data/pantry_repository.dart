import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/add_pantry_item.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/add_pantry_item.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/add_pantry_item.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_pantry_item.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_pantry_item.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_pantry_item.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/pantry.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/pantry.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/pantry.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_pantry_item.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_pantry_item.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_pantry_item.var.gql.dart';
import '../domain/pantry_item.dart';
import '../domain/pantry_item_draft.dart';
import '../domain/pantry_item_patch.dart';
import 'pantry_mapper.dart';

/// The app's pantry surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of [AppError] and
/// nothing else — same contract as `HouseholdRepository`.
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

  /// Adds [draft] to [householdId]'s pantry. Requires the caller to already
  /// be a member; `addedBy` is never sent — the server takes it from the
  /// verified caller.
  Future<PantryItem> addPantryItem(String householdId, PantryItemDraft draft);

  /// Applies [patch] to the item [id] and returns the whole updated row.
  ///
  /// Takes no `householdId` — a nonexistent [id] and a real [id] in another
  /// household both throw the identical [NotFoundError]. See
  /// `shared/schema.graphql`'s doc on `Mutation.updatePantryItem`.
  Future<PantryItem> updatePantryItem(String id, PantryItemPatch patch);

  /// Deletes the item [id] and returns the row that was deleted. Same
  /// id-only membership resolution as [updatePantryItem].
  Future<PantryItem> deletePantryItem(String id);
}

/// Boxes an `AWSDate` string into the generated `GAWSDate` builder Ferry's
/// input types expect — see `pantry_mapper.dart`'s identical read-direction
/// note for why the wire type isn't a plain `String`. `null` in, `null`
/// builder out: an absent date must stay absent, not become an empty-string
/// `GAWSDate`.
GAWSDateBuilder? _awsDateBuilder(String? value) =>
    value == null ? null : GAWSDate(value).toBuilder();

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

  @override
  Future<PantryItem> addPantryItem(
    String householdId,
    PantryItemDraft draft,
  ) async {
    final GAddPantryItemReq request = GAddPantryItemReq(
      (GAddPantryItemReqBuilder b) => b
        ..vars = (GAddPantryItemVarsBuilder()
          ..householdId = householdId
          ..input.name = draft.name
          ..input.quantity = draft.quantity
          ..input.unit = draft.unit
          ..input.category = draft.category
          ..input.isStaple = draft.isStaple
          ..input.expiryDate = _awsDateBuilder(draft.expiryDate)
          ..input.lowThreshold = draft.lowThreshold),
    );

    final GAddPantryItemData data = await _execute(request);
    return pantryItemFromGraphQL(data.addPantryItem);
  }

  @override
  Future<PantryItem> updatePantryItem(String id, PantryItemPatch patch) async {
    final GUpdatePantryItemReq request = GUpdatePantryItemReq(
      (GUpdatePantryItemReqBuilder b) => b
        ..vars = (GUpdatePantryItemVarsBuilder()
          ..id = id
          ..input.name = patch.name
          ..input.quantity = patch.quantity
          ..input.unit = patch.unit
          ..input.category = patch.category
          ..input.isStaple = patch.isStaple
          ..input.expiryDate = _awsDateBuilder(patch.expiryDate)
          ..input.lowThreshold = patch.lowThreshold),
    );

    final GUpdatePantryItemData data = await _execute(request);
    return pantryItemFromGraphQL(data.updatePantryItem);
  }

  @override
  Future<PantryItem> deletePantryItem(String id) async {
    final GDeletePantryItemReq request = GDeletePantryItemReq(
      (GDeletePantryItemReqBuilder b) => b
        ..vars = (GDeletePantryItemVarsBuilder()..id = id),
    );

    final GDeletePantryItemData data = await _execute(request);
    return pantryItemFromGraphQL(data.deletePantryItem);
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
