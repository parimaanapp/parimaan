/// W17 S4/S6 (E2E_MVP_PLAN.md §23.2.8 D8) — the client-side half of
/// `exportShoppingListImage(listId: ID!): String!`.
///
/// W17 S6 wired this to the real GraphQL mutation (`ExportShoppingListImage`,
/// `lib/shared/graphql/operations/export_shopping_list_image.graphql`) —
/// confirmed present server-side first (`shared/schema.graphql`'s own
/// `exportShoppingListImage` field, `api/src/resolvers
/// /exportShoppingListImage.ts`), closing the real, confirmed gap W17 S4's
/// own doc comment previously named here ("not wired to the real GraphQL
/// mutation yet"). [ShoppingListImageExportRepository] stays the seam that
/// isolates the rest of this feature (the share flow in
/// `shopping_list_share_image_screen.dart`) from the implementation behind
/// it — the call site only ever sees this interface and already treats a
/// thrown error from it as fire-and-forget (never blocking the share-sheet
/// flow the user actually came for, per D8).
library;

import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/ferry_execute.dart';
import '../../../shared/graphql/operations/__generated__/export_shopping_list_image.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/export_shopping_list_image.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/export_shopping_list_image.var.gql.dart';

/// Returns a presigned S3 PUT URL for the given [listId]'s image export —
/// the client-side mirror of `Mutation.exportShoppingListImage`.
abstract interface class ShoppingListImageExportRepository {
  /// Throws on any failure (network, GraphQL error, or — for the stub — by
  /// design). Callers MUST treat this as fire-and-forget per D8: a thrown
  /// error here is logged, never surfaced to the user, and never blocks or
  /// delays the share-sheet flow that already completed by the time this is
  /// called.
  Future<String> exportShoppingListImage(String listId);
}

/// Ferry-backed [ShoppingListImageExportRepository] (W17 S6) — same
/// calling convention as `FerryShoppingListRepository`'s own mutation
/// methods (`shopping_list_repository.dart`): build the generated request,
/// `execute` it via [FerryExecuteMixin], and return the `String!` response
/// straight through (no mapper needed — there is no object to map, per D8's
/// own explicit rejection of the richer `PresignedUpload!` shape).
class FerryShoppingListImageExportRepository
    with FerryExecuteMixin
    implements ShoppingListImageExportRepository {
  const FerryShoppingListImageExportRepository({required this.client});

  @override
  final Client client;

  @override
  Future<String> exportShoppingListImage(String listId) async {
    final GExportShoppingListImageReq request = GExportShoppingListImageReq(
      (GExportShoppingListImageReqBuilder b) =>
          b..vars = (GExportShoppingListImageVarsBuilder()..listId = listId),
    );

    final GExportShoppingListImageData data = await execute(request);
    return data.exportShoppingListImage;
  }
}

/// STUB — kept only as a safe, honest fallback for a context with no Ferry
/// client wired (e.g. a unit test that never touches this provider). Every
/// call site already treats a thrown error here as an ordinary, expected
/// fire-and-forget failure per D8.
class UnimplementedShoppingListImageExportRepository
    implements ShoppingListImageExportRepository {
  const UnimplementedShoppingListImageExportRepository();

  @override
  Future<String> exportShoppingListImage(String listId) {
    throw UnimplementedError(
      'exportShoppingListImage has no real repository wired in this '
      'context — this is the documented stub from '
      'shopping_list_image_export_repository.dart. The resulting failure '
      'is caught and logged only, per D8\'s fire-and-forget requirement; '
      'it must never reach the user.',
    );
  }
}

/// Injection point — same default-to-real-Ferry-impl shape as
/// `shoppingListRepositoryProvider` et al. (W17 S6 — binds to the real
/// implementation now that the server-side mutation exists).
final Provider<ShoppingListImageExportRepository>
shoppingListImageExportRepositoryProvider =
    Provider<ShoppingListImageExportRepository>(
      (Ref ref) => FerryShoppingListImageExportRepository(
        client: ref.watch(ferryClientProvider),
      ),
    );
