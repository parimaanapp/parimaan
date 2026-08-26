import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/graphql/appsync_realtime_protocol.dart';

void main() {
  const String httpUrl =
      'https://abc123xyz.appsync-api.ap-south-1.amazonaws.com/graphql';

  group('appSyncRealtimeUri', () {
    test('rewrites appsync-api to appsync-realtime-api and scheme to wss', () {
      final Uri uri = appSyncRealtimeUri(httpUrl);
      expect(uri.scheme, 'wss');
      expect(uri.host, 'abc123xyz.appsync-realtime-api.ap-south-1.amazonaws.com');
      expect(uri.path, '/graphql');
    });
  });

  group('appSyncApiHost', () {
    test('returns the original (non-realtime) host', () {
      expect(appSyncApiHost(httpUrl), 'abc123xyz.appsync-api.ap-south-1.amazonaws.com');
    });
  });

  group('appSyncAuthHeader', () {
    test('base64-encodes a {host, Authorization} JSON blob', () {
      final String encoded = appSyncAuthHeader(host: 'example.com', idToken: 'token-123');
      final Map<String, dynamic> decoded =
          jsonDecode(utf8.decode(base64Url.decode(encoded))) as Map<String, dynamic>;
      expect(decoded, <String, String>{'host': 'example.com', 'Authorization': 'token-123'});
    });
  });

  group('appSyncConnectUri', () {
    test('carries header and payload query params over the realtime URI', () {
      final Uri uri = appSyncConnectUri(httpUrl, idToken: 'token-123');
      expect(uri.scheme, 'wss');
      expect(uri.host, 'abc123xyz.appsync-realtime-api.ap-south-1.amazonaws.com');
      expect(uri.queryParameters['header'], isNotNull);
      expect(uri.queryParameters['payload'], isNotNull);

      final Map<String, dynamic> header = jsonDecode(
        utf8.decode(base64Url.decode(uri.queryParameters['header']!)),
      ) as Map<String, dynamic>;
      expect(header['host'], 'abc123xyz.appsync-api.ap-south-1.amazonaws.com');
      expect(header['Authorization'], 'token-123');

      final String payload = utf8.decode(base64Url.decode(uri.queryParameters['payload']!));
      expect(payload, '{}');
    });
  });

  group('connectionInitFrame', () {
    test('is exactly {"type": "connection_init"}', () {
      expect(connectionInitFrame(), <String, Object?>{'type': 'connection_init'});
    });
  });

  group('startFrame', () {
    test('carries query+variables as a JSON string in payload.data', () {
      final Map<String, Object?> frame = startFrame(
        id: 'sub-1',
        query: 'subscription OnPantryChanged(\$householdId: ID!) { onPantryChanged(householdId: \$householdId) { id } }',
        variables: <String, Object?>{'householdId': 'household-1'},
        idToken: 'token-123',
        host: 'abc123xyz.appsync-api.ap-south-1.amazonaws.com',
      );

      expect(frame['id'], 'sub-1');
      expect(frame['type'], 'start');
      final payload = frame['payload'] as Map<String, Object?>;
      final data = jsonDecode(payload['data'] as String) as Map<String, dynamic>;
      expect(data['variables'], <String, Object?>{'householdId': 'household-1'});
      expect(data['query'], contains('OnPantryChanged'));

      final extensions = payload['extensions'] as Map<String, Object?>;
      final authorization = extensions['authorization'] as Map<String, Object?>;
      expect(authorization['Authorization'], 'token-123');
      expect(authorization['host'], 'abc123xyz.appsync-api.ap-south-1.amazonaws.com');
    });
  });

  group('stopFrame', () {
    test('is exactly {"id", "type": "stop"}', () {
      expect(stopFrame('sub-1'), <String, Object?>{'id': 'sub-1', 'type': 'stop'});
    });
  });
}
