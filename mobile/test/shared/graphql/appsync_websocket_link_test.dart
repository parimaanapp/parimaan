import 'dart:async';

import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/graphql/appsync_websocket_link.dart';
import 'package:mobile/shared/graphql/auth_link.dart';
import 'package:mobile/shared/graphql/operations/__generated__/me.req.gql.dart';
import 'package:mobile/shared/graphql/operations/__generated__/on_pantry_changed.req.gql.dart';
import 'package:mobile/shared/graphql/subscription_client.dart';

import '../../support/fake_web_socket_channel.dart';

/// A terminating link that records what reached it and answers with an empty
/// success — mirrors `auth_link_test.dart`'s own fixture.
class _RecordingLink extends Link {
  final List<Request> requests = <Request>[];

  @override
  Stream<Response> request(Request request, [NextLink? forward]) async* {
    requests.add(request);
    yield const Response(data: <String, dynamic>{}, response: <String, dynamic>{});
  }
}

const String _httpUrl = 'https://abc.appsync-api.ap-south-1.amazonaws.com/graphql';

void main() {
  group('AppSyncWebSocketLink', () {
    test('forwards a non-subscription operation to the next link unchanged', () async {
      final _RecordingLink terminating = _RecordingLink();
      final AppSyncSubscriptionClient subscriptionClient = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => FakeWebSocketChannel(),
      );
      final Link link = Link.from(<Link>[
        AuthLink(idTokenProvider: () async => 'the-id-token'),
        AppSyncWebSocketLink(subscriptionClient: subscriptionClient),
        terminating,
      ]);

      await link.request(GMeReq().execRequest).toList();

      expect(terminating.requests, hasLength(1));
    });

    test('routes a subscription operation to the subscription client, not the next link', () async {
      final _RecordingLink terminating = _RecordingLink();
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient subscriptionClient = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );
      final Link link = Link.from(<Link>[
        AuthLink(idTokenProvider: () async => 'the-id-token'),
        AppSyncWebSocketLink(subscriptionClient: subscriptionClient),
        terminating,
      ]);

      final Request request = GOnPantryChangedReq(
        (GOnPantryChangedReqBuilder b) => b.vars.householdId = 'household-1',
      ).execRequest;
      final StreamSubscription<Response> sub = link.request(request).listen((_) {});
      addTearDown(sub.cancel);
      await pumpEventQueue();

      expect(terminating.requests, isEmpty);
      expect(channel.sentFrames.single['type'], 'connection_init');
    });

    test('a subscription reaching this link with no Authorization header errors with UnauthorizedError, never reaching the socket', () async {
      // AuthLink already throws before a token-less request gets this far in
      // the real chain — this exercises AppSyncWebSocketLink's own guard
      // directly (called standalone, no AuthLink in front of it), the defense-
      // in-depth case if the link order were ever changed.
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient subscriptionClient = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );
      final AppSyncWebSocketLink link = AppSyncWebSocketLink(
        subscriptionClient: subscriptionClient,
      );

      final Request request = GOnPantryChangedReq(
        (GOnPantryChangedReqBuilder b) => b.vars.householdId = 'household-1',
      ).execRequest;

      await expectLater(link.request(request), emitsError(isA<UnauthorizedError>()));
      expect(channel.sentFrames, isEmpty);
    });
  });
}
