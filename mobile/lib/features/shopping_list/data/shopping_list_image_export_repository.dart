/// W17 S4 (E2E_MVP_PLAN.md §23.2.8 D8) — the client-side half of
/// `exportShoppingListImage(listId: ID!): String!`.
///
/// This mutation is server-side W17 S3's job, not this slice's. As of this
/// slice, `shared/schema.graphql` (checked against `main` before writing
/// this file) defines no such field, so there is no generated Ferry
/// request type to call yet. [ShoppingListImageExportRepository] is the
/// seam that isolates the rest of this feature (the share flow in
/// `shopping_list_share_image_screen.dart`) from that fact: the call site
/// only ever sees this interface, already treats a thrown error from it as
/// fire-and-forget (never blocking the share-sheet flow the user actually
/// came for, per D8), and does not care whether the implementation behind
/// it is real or a stub.
///
/// Swapping the stub for the real thing, once S3 lands, is a one-file
/// change: implement this interface with a Ferry-backed class that builds
/// `GExportShoppingListImageReq(...)`, maps its `String!` response straight
/// through, and update `shoppingListImageExportRepositoryProvider` (bottom
/// of this file) to construct it instead of
/// [UnimplementedShoppingListImageExportRepository]. No other file in this
/// feature needs to change.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

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

/// STUB — see this file's own top-of-file doc. Always fails; every call
/// site treats that failure as an ordinary, expected fire-and-forget
/// failure, so this stub is a safe, honest default until the real GraphQL
/// mutation is wired.
class UnimplementedShoppingListImageExportRepository
    implements ShoppingListImageExportRepository {
  const UnimplementedShoppingListImageExportRepository();

  @override
  Future<String> exportShoppingListImage(String listId) {
    throw UnimplementedError(
      'exportShoppingListImage is not wired to the real GraphQL mutation yet '
      '(W17 S3 had not landed on main when W17 S4 shipped) — this is the '
      'documented stub from shopping_list_image_export_repository.dart. The '
      'resulting failure is caught and logged only, per D8\'s fire-and-forget '
      'requirement; it must never reach the user.',
    );
  }
}

/// Injection point — same default-to-real(-or-stub)-impl shape as every
/// other repository provider in this codebase
/// (`shoppingListRepositoryProvider` et al.). Currently binds to the stub;
/// see this file's top-of-file doc for the one-line swap once S3 ships.
final Provider<ShoppingListImageExportRepository>
shoppingListImageExportRepositoryProvider =
    Provider<ShoppingListImageExportRepository>(
      (Ref ref) => const UnimplementedShoppingListImageExportRepository(),
    );
