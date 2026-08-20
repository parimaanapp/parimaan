import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/graphql/auth_link.dart';
import 'package:mobile/shared/graphql/operations/__generated__/me.req.gql.dart';

/// A terminating link that records what reached it and answers with an empty
/// success, so assertions are about headers rather than payloads.
class _RecordingLink extends Link {
  final List<Request> requests = <Request>[];

  @override
  Stream<Response> request(Request request, [NextLink? forward]) async* {
    requests.add(request);
    yield const Response(
      data: <String, dynamic>{},
      response: <String, dynamic>{},
    );
  }
}

/// A minimal request. The document is irrelevant to `AuthLink`, which only
/// ever touches the context — so this uses a generated operation's AST rather
/// than adding a direct `gql` dependency just to parse a string in a test.
Request _request() => GMeReq().execRequest;

Map<String, String> _headersOf(Request request) =>
    request.context.entry<HttpLinkHeaders>()?.headers ?? <String, String>{};

void main() {
  group('AuthLink', () {
    test('sets Authorization to the raw id token', () async {
      final _RecordingLink terminating = _RecordingLink();
      final Link link = Link.from(<Link>[
        AuthLink(idTokenProvider: () async => 'the-id-token'),
        terminating,
      ]);

      await link.request(_request()).toList();

      expect(
        _headersOf(terminating.requests.single)[AuthLink.authorizationHeader],
        // Raw, with no `Bearer ` prefix — see AuthLink's doc.
        'the-id-token',
      );
    });

    test('preserves headers another link already set', () async {
      final _RecordingLink terminating = _RecordingLink();
      final Link link = Link.from(<Link>[
        AuthLink(idTokenProvider: () async => 'the-id-token'),
        terminating,
      ]);

      final Request request = _request().withContextEntry(
        const HttpLinkHeaders(headers: <String, String>{'x-trace': 'abc'}),
      );
      await link.request(request).toList();

      final Map<String, String> headers = _headersOf(
        terminating.requests.single,
      );
      expect(headers['x-trace'], 'abc');
      expect(headers[AuthLink.authorizationHeader], 'the-id-token');
    });

    test('fetches the token per request rather than caching it', () async {
      final _RecordingLink terminating = _RecordingLink();
      int calls = 0;
      final Link link = Link.from(<Link>[
        AuthLink(idTokenProvider: () async => 'token-${++calls}'),
        terminating,
      ]);

      await link.request(_request()).toList();
      await link.request(_request()).toList();

      expect(
        _headersOf(terminating.requests[0])[AuthLink.authorizationHeader],
        'token-1',
      );
      expect(
        _headersOf(terminating.requests[1])[AuthLink.authorizationHeader],
        'token-2',
      );
    });

    test(
      'throws UnauthorizedError and sends nothing when there is no token',
      () {
        final _RecordingLink terminating = _RecordingLink();
        final Link link = Link.from(<Link>[
          AuthLink(idTokenProvider: () async => null),
          terminating,
        ]);

        expect(
          link.request(_request()).toList(),
          throwsA(isA<UnauthorizedError>()),
        );
        expect(terminating.requests, isEmpty);
      },
    );

    test('treats an empty token as no token', () {
      final Link link = Link.from(<Link>[
        AuthLink(idTokenProvider: () async => ''),
        _RecordingLink(),
      ]);

      expect(
        link.request(_request()).toList(),
        throwsA(isA<UnauthorizedError>()),
      );
    });

    test('a failing token provider becomes UnauthorizedError, never its own '
        'vendor exception', () {
      final Link link = Link.from(<Link>[
        AuthLink(
          idTokenProvider: () async => throw StateError('amplify blew up'),
        ),
        _RecordingLink(),
      ]);

      expect(
        link.request(_request()).toList(),
        throwsA(isA<UnauthorizedError>()),
      );
    });
  });
}
