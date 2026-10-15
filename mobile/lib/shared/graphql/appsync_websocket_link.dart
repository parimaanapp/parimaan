import 'package:gql/ast.dart';
import 'package:gql/language.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:gql_link/gql_link.dart';

import '../errors/app_error.dart';
import 'auth_link.dart';
import 'subscription_client.dart';

/// Routes `subscription` operations to [AppSyncSubscriptionClient]'s
/// hand-rolled AppSync real-time transport; forwards every other operation
/// unchanged to the next link (`HttpLink`, per [client.dart]'s chain order).
///
/// Belongs in `shared/graphql/` rather than `features/pantry/` — this is the
/// one WebSocket link for the whole app (E2E_MVP_PLAN.md §11.3 S8 step 2b);
/// W8/W11/W12 subscriptions reuse it, not a second connection.
///
/// Deliberately positioned **after** [AuthLink] in the chain
/// (`Link.from([AuthLink(...), AppSyncWebSocketLink(...), HttpLink(...)])`):
/// this link reads the id token [AuthLink] already put in the request's
/// [HttpLinkHeaders] context entry rather than fetching its own, so a signed-
/// out caller gets the identical [UnauthorizedError] for a subscription as
/// for a query — one auth check, not two independently-maintained ones.
class AppSyncWebSocketLink extends Link {
  AppSyncWebSocketLink({required this.subscriptionClient});

  final AppSyncSubscriptionClient subscriptionClient;

  @override
  Stream<Response> request(Request request, [NextLink? forward]) {
    if (!_isSubscription(request.operation)) {
      if (forward == null) {
        throw const InternalError(
          'AppSyncWebSocketLink is not a terminating link for non-subscription '
          'operations — chain an HttpLink after it.',
        );
      }
      return forward(request);
    }

    final String? idToken = request.context.entry<HttpLinkHeaders>()?.headers[AuthLink.authorizationHeader];
    if (idToken == null) {
      return Stream<Response>.error(
        const UnauthorizedError('You are signed out. Sign in again to continue.'),
      );
    }

    return subscriptionClient.subscribe(
      query: printNode(request.operation.document),
      variables: request.variables,
      idToken: idToken,
    );
  }

  bool _isSubscription(Operation operation) {
    final OperationDefinitionNode? definition = operation.document.definitions
        .whereType<OperationDefinitionNode>()
        .where(
          (OperationDefinitionNode d) =>
              operation.operationName == null || d.name?.value == operation.operationName,
        )
        .firstOrNull;
    return definition?.type == OperationType.subscription;
  }
}
