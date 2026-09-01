import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gql_http_link/gql_http_link.dart';

import '../../app/config/app_config.dart';
import '../../features/auth/data/auth_repository.dart';
import 'appsync_websocket_link.dart';
import 'auth_link.dart';
import 'graphql_error_mapper.dart';
import 'subscription_client.dart';

/// Builds the app's Ferry [Client] for one environment.
///
/// Link order matters and is not arbitrary: [AuthLink] runs first so every
/// request carries an `Authorization` header by the time [HttpLink] serializes
/// it, and [HttpLink] terminates the chain.
///
/// [AppSyncResponseParser] is installed here — the single place responsible
/// for preserving AppSync's non-spec top-level `errorType`. See that class for
/// the full finding; without it every error reaches the client untyped and
/// `graphql_error_mapper.dart` can only ever return [InternalError].
///
/// The cache is in-memory (ferry's default `Cache()` with no `store`).
/// Persisting it across launches is an offline-support decision belonging to
/// the W23 offline slice, not to this one — and a persisted cache of household
/// data is a privacy surface that deserves its own review rather than arriving
/// as a side effect of wiring a client.
Client buildFerryClient({
  required AppConfig config,
  required IdTokenProvider idTokenProvider,
  AppSyncSubscriptionClient? subscriptionClient,
  Cache? cache,
}) {
  final Link link = Link.from(<Link>[
    AuthLink(idTokenProvider: idTokenProvider),
    AppSyncWebSocketLink(
      subscriptionClient:
          subscriptionClient ??
          AppSyncSubscriptionClient(
            httpGraphQlUrl: config.graphQlUrl,
            idTokenProvider: idTokenProvider,
          ),
    ),
    HttpLink(config.graphQlUrl, parser: const AppSyncResponseParser()),
  ]);

  return Client(link: link, cache: cache ?? Cache());
}

/// Injection point for the Ferry [Client].
///
/// Mirrors `authRepositoryProvider`'s shape deliberately: no default, because
/// a default would have to hardcode an [AppConfig] here or silently work in a
/// test that meant to inject a fake. The composition root (`main.dart`)
/// overrides it; tests override it with a client over a fake `Link`.
final Provider<Client> ferryClientProvider = Provider<Client>(
  (Ref ref) => throw UnimplementedError(
    'ferryClientProvider must be overridden — see main.dart (production) or '
    'test/support/fake_link.dart (tests).',
  ),
);

/// The production [Client] for [config], wired to the app's real
/// [AuthRepository] for tokens.
///
/// A function rather than a provider so `main.dart` stays the only place that
/// chooses an environment, exactly as it already is for `AuthRepository`.
Override ferryClientOverride(AppConfig config) =>
    ferryClientProvider.overrideWith((Ref ref) {
      final AppSyncSubscriptionClient subscriptionClient = AppSyncSubscriptionClient(
        httpGraphQlUrl: config.graphQlUrl,
        idTokenProvider: ref.watch(authRepositoryProvider).currentIdToken,
      );
      final Client client = buildFerryClient(
        config: config,
        idTokenProvider: ref.watch(authRepositoryProvider).currentIdToken,
        subscriptionClient: subscriptionClient,
      );
      ref.onDispose(client.dispose);
      ref.onDispose(subscriptionClient.disconnect);
      return client;
    });
