import 'package:ferry/ferry.dart';

import '../errors/app_error.dart';
import 'graphql_error_mapper.dart';

/// Shared ferry-operation reduction for `Client`-backed repositories.
///
/// Mix this into a repository that holds a [client] to get [execute]: it
/// runs one operation and reduces ferry's stream-of-responses to a single
/// value or a single [AppError].
///
/// **Error contract:** [execute] throws a subtype of [AppError] and nothing
/// else — no `GraphQLError`, no `LinkException`, no `built_value`
/// deserialization failure.
mixin FerryExecuteMixin {
  Client get client;

  /// Runs [request] and reduces ferry's stream-of-responses to a single
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
  Future<TData> execute<TData, TVars>(
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
