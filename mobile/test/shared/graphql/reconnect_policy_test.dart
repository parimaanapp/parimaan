import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/graphql/reconnect_policy.dart';

/// A fixed-sequence `Random` double source so jitter is deterministic —
/// `nextDouble()` returns each of [values] in turn, then repeats the last.
class _FixedRandom implements math.Random {
  _FixedRandom(this.values);

  final List<double> values;
  int _index = 0;

  @override
  double nextDouble() {
    final double value = values[_index < values.length ? _index : values.length - 1];
    _index++;
    return value;
  }

  @override
  bool nextBool() => throw UnimplementedError();

  @override
  int nextInt(int max) => throw UnimplementedError();
}

void main() {
  group('ReconnectPolicy', () {
    test('the ladder is 1s, 2s, 5s, 15s, 60s, then stays at 60s', () {
      // nextDouble() = 0.5 -> jitter factor exactly 1.0 (the midpoint of
      // 0.8..1.2), so each delay equals its ladder step precisely.
      final ReconnectPolicy policy = ReconnectPolicy(random: _FixedRandom(<double>[0.5]));

      expect(policy.nextDelay(), const Duration(seconds: 1));
      expect(policy.nextDelay(), const Duration(seconds: 2));
      expect(policy.nextDelay(), const Duration(seconds: 5));
      expect(policy.nextDelay(), const Duration(seconds: 15));
      expect(policy.nextDelay(), const Duration(seconds: 60));
      // Exhausted the ladder — stays at the last step, not an error and not
      // an ever-growing delay.
      expect(policy.nextDelay(), const Duration(seconds: 60));
      expect(policy.nextDelay(), const Duration(seconds: 60));
    });

    test('reset() starts the ladder over at 1s, not from wherever it left off', () {
      final ReconnectPolicy policy = ReconnectPolicy(random: _FixedRandom(<double>[0.5]));

      expect(policy.nextDelay(), const Duration(seconds: 1));
      expect(policy.nextDelay(), const Duration(seconds: 2));
      expect(policy.nextDelay(), const Duration(seconds: 5));

      policy.reset();

      expect(policy.nextDelay(), const Duration(seconds: 1));
      expect(policy.nextDelay(), const Duration(seconds: 2));
    });

    test('jitter keeps every delay inside its declared ±20% band', () {
      final ReconnectPolicy policy = ReconnectPolicy(); // real Random — many samples

      const List<Duration> ladder = <Duration>[
        Duration(seconds: 1),
        Duration(seconds: 2),
        Duration(seconds: 5),
        Duration(seconds: 15),
        Duration(seconds: 60),
      ];

      for (int cycle = 0; cycle < 200; cycle++) {
        policy.reset();
        for (final Duration base in ladder) {
          final Duration delay = policy.nextDelay();
          final int lowerBoundUs = (base.inMicroseconds * 0.8).round();
          final int upperBoundUs = (base.inMicroseconds * 1.2).round();
          expect(
            delay.inMicroseconds,
            inInclusiveRange(lowerBoundUs, upperBoundUs),
            reason: 'base=$base delay=$delay',
          );
        }
      }
    });

    test('jitter is not a constant — at least two distinct delays across many samples', () {
      final ReconnectPolicy policy = ReconnectPolicy();
      final Set<int> observed = <int>{};
      for (int i = 0; i < 50; i++) {
        policy.reset();
        observed.add(policy.nextDelay().inMicroseconds);
      }
      expect(
        observed.length,
        greaterThan(1),
        reason: 'a real Random should not produce the exact same jittered delay 50 times running',
      );
    });
  });
}
