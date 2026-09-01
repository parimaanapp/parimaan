import 'dart:math' as math;

/// The reconnect backoff ladder [AppSyncSubscriptionClient] uses after an
/// established connection dies (W8 S3, §14.2.2/§11.3 S8 step 2d's own
/// numbers): 1s → 2s → 5s → 15s → 60s, then stays at 60s until a successful
/// reconnect calls [reset].
///
/// A pure value object — no `Timer`, no socket, nothing Flutter — so the
/// ladder's own shape (does it advance correctly, does it reset correctly,
/// does jitter stay in band) can be asserted without a fake channel or
/// `fakeAsync` at all. [AppSyncSubscriptionClient] owns turning [nextDelay]
/// into an actual scheduled retry.
class ReconnectPolicy {
  ReconnectPolicy({math.Random? random}) : _random = random ?? math.Random();

  /// The ladder itself. `bMin`/`bMax`-style range tables elsewhere in this
  /// codebase (`api/src/net/safeUrl.ts`) are the precedent for a short,
  /// literal, documented list over a formula — five fixed steps is easier to
  /// verify against the locked plan's own numbers than reverse-engineering
  /// them from an exponent and a multiplier would be.
  static const List<Duration> _ladder = <Duration>[
    Duration(seconds: 1),
    Duration(seconds: 2),
    Duration(seconds: 5),
    Duration(seconds: 15),
    Duration(seconds: 60),
  ];

  /// ±20% — standard "backoff with full jitter" range. Not optional
  /// (§14.5.7): a fixed ladder across every household member whose
  /// connections drop at the same moment (a fan-out, a cell tower, an
  /// AppSync deploy) reconnects them all in lockstep, which is exactly the
  /// "reconnect storm" `RUNBOOK.md` §2 already lists as an anticipated
  /// incident class.
  static const double _jitterMin = 0.8;
  static const double _jitterMax = 1.2;

  final math.Random _random;
  int _attempt = 0;

  /// The delay before the next reconnect attempt, jittered. Each call
  /// advances the ladder one step (capped at the last entry, which repeats
  /// indefinitely until [reset]) — call this exactly once per scheduled
  /// attempt, not once per check, or the ladder advances faster than real
  /// attempts are actually being made.
  Duration nextDelay() {
    final Duration base = _ladder[_attempt];
    if (_attempt < _ladder.length - 1) {
      _attempt++;
    }
    final double jitterFactor = _jitterMin + _random.nextDouble() * (_jitterMax - _jitterMin);
    return Duration(microseconds: (base.inMicroseconds * jitterFactor).round());
  }

  /// Call on a successful reconnect (a fresh `connection_ack`) — the next
  /// failure starts the ladder over at 1s, not continuing from wherever a
  /// prior, now-irrelevant failure sequence left off.
  void reset() {
    _attempt = 0;
  }
}
