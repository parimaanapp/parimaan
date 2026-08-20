import 'package:built_value/serializer.dart';

/// Serializes AppSync's `AWSDateTime` scalar, which is an **ISO-8601 string**.
///
/// ## Why this has to exist
///
/// `build.yaml` maps `AWSDateTime` to Dart's `DateTime`, which makes the
/// generated code ask `built_value` to deserialize a `DateTime`. Its
/// **standard `DateTimeSerializer` expects microseconds since the epoch as an
/// `int`** — so an ISO-8601 string fails with
/// `type 'String' is not a subtype of type 'int' in type cast`, and, because
/// this happens inside ferry's link chain, it surfaces as an opaque
/// `LinkException` rather than anything that names the real problem.
///
/// Registering this via `custom_serializers` in `build.yaml` replaces the
/// standard serializer for `DateTime` (`built_value` keys serializers by type,
/// so the later `add` wins).
///
/// The alternative — mapping `AWSDateTime` to `String` and parsing in the
/// domain mappers — was rejected: it would push an ISO-parsing failure past
/// the data layer and into every consumer, and there is no legitimate reason
/// for the UI to see a timestamp as text.
///
/// ## UTC
///
/// `serialize` normalises to UTC before formatting, so a round trip cannot
/// silently move a timestamp by the device's offset. `deserialize` keeps
/// whatever offset the server sent (AppSync sends `Z`), because
/// `DateTime.parse` already resolves it correctly and converting to local time
/// here would make equality assertions depend on the machine's timezone.
class AWSDateTimeSerializer implements PrimitiveSerializer<DateTime> {
  const AWSDateTimeSerializer();

  @override
  Iterable<Type> get types => const <Type>[DateTime];

  /// Must be `DateTime`, not `AWSDateTime`: `built_value` looks the serializer
  /// up by this name when deserializing a `DateTime`-typed field.
  @override
  String get wireName => 'DateTime';

  @override
  Object serialize(
    Serializers serializers,
    DateTime dateTime, {
    FullType specifiedType = FullType.unspecified,
  }) => dateTime.toUtc().toIso8601String();

  @override
  DateTime deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    if (serialized is String) {
      return DateTime.parse(serialized);
    }
    // Defensive, not expected: `built_value`'s own standard representation is
    // microseconds-since-epoch, so a payload produced by a Dart client (an
    // optimistic response, a cached write) can legitimately arrive as an int.
    if (serialized is int) {
      return DateTime.fromMicrosecondsSinceEpoch(serialized, isUtc: true);
    }
    throw ArgumentError.value(
      serialized,
      'serialized',
      'AWSDateTime must be an ISO-8601 String',
    );
  }
}
