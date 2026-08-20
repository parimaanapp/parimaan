import 'package:gql_exec/gql_exec.dart';
import 'package:gql_link/gql_link.dart';
import 'package:mobile/shared/graphql/graphql_error_mapper.dart';

/// A terminating [Link] driven by a plain callback, so tests can hand a Ferry
/// `Client` a canned wire payload.
///
/// Preferred over mocking `ferry`'s `Client`: `Client.request` is a generic
/// method whose type arguments a `mocktail` double cannot carry, and — more
/// usefully — going through a real `Client` exercises the generated
/// `built_value` deserializers and the [ResponseParser], which is where the
/// AWSJSON / AWSDateTime and `errorType` handling actually lives. A mocked
/// client would hand back a hand-built data object and prove none of that.
class FakeLink extends Link {
  FakeLink(this.respond, {this.parser = const AppSyncResponseParser()});

  /// Called once per request. Returns the raw JSON body an AppSync response
  /// would have — `{'data': ..., 'errors': ...}` — or throws to simulate a
  /// link-level failure.
  final Map<String, dynamic> Function(Request request) respond;

  /// Defaults to the production parser so tests exercise the same
  /// `errorType`-lifting the real client does.
  final ResponseParser parser;

  /// Every request this link has seen, in order. Lets a test assert on the
  /// operation name and variables actually sent.
  final List<Request> requests = <Request>[];

  @override
  Stream<Response> request(Request request, [NextLink? forward]) async* {
    requests.add(request);
    yield parser.parseResponse(respond(request));
  }
}
