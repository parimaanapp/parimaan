import 'package:fake_async/fake_async.dart';
import 'package:flutter/widgets.dart' show AppLifecycleState;
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/state/household_sync_policy.dart';

/// Builds a policy plus the counter its refetch increments.
///
/// Every test drives this inside `fakeAsync`, so no test waits on a real
/// 15-second timer — the whole point of `fake_async` here. A cadence test
/// written with real `Future.delayed`s would take minutes and be flaky on CI.
({HouseholdSyncPolicy policy, List<int> calls}) _subject({
  Duration pollInterval = HouseholdSyncPolicy.defaultPollInterval,
  Duration idleTimeout = HouseholdSyncPolicy.defaultIdleTimeout,
}) {
  final List<int> calls = <int>[];
  final HouseholdSyncPolicy policy = HouseholdSyncPolicy(
    refetch: () async => calls.add(calls.length),
    pollInterval: pollInterval,
    idleTimeout: idleTimeout,
  );
  return (policy: policy, calls: calls);
}

void main() {
  group('HouseholdSyncPolicy — route entry', () {
    test('start() refetches immediately, before any timer elapses', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();

        expect(
          subject.calls,
          hasLength(1),
          reason: 'entering the route is itself a refetch trigger',
        );

        subject.policy.dispose();
      });
    });

    test('a second start() does not stack a second poll timer', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        subject.policy.start();
        async.flushMicrotasks();
        // Two entry refetches (each start is a route entry), but the cadence
        // afterwards must still be one-per-interval, not two.
        final int afterStarts = subject.calls.length;

        async.elapse(HouseholdSyncPolicy.defaultPollInterval);
        expect(subject.calls.length - afterStarts, 1);

        subject.policy.dispose();
      });
    });
  });

  group('HouseholdSyncPolicy — poll cadence', () {
    test('polls once per interval while active', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        expect(subject.calls, hasLength(1));

        async.elapse(HouseholdSyncPolicy.defaultPollInterval);
        expect(subject.calls, hasLength(2));

        async.elapse(HouseholdSyncPolicy.defaultPollInterval);
        expect(subject.calls, hasLength(3));

        subject.policy.dispose();
      });
    });

    test('does not poll before a full interval has elapsed', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();

        async.elapse(
          HouseholdSyncPolicy.defaultPollInterval - const Duration(seconds: 1),
        );

        expect(subject.calls, hasLength(1));
        subject.policy.dispose();
      });
    });

    test('stop() ends the cadence', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        subject.policy.stop();

        async.elapse(HouseholdSyncPolicy.defaultPollInterval * 5);

        expect(subject.calls, hasLength(1));
        subject.policy.dispose();
      });
    });
  });

  group('HouseholdSyncPolicy — decay to off after idle', () {
    test('stops polling once the idle timeout is reached', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();

        // 2 minutes of idle at a 15s cadence is 8 polls, and then silence.
        async.elapse(HouseholdSyncPolicy.defaultIdleTimeout);
        final int atDecay = subject.calls.length;

        async.elapse(HouseholdSyncPolicy.defaultIdleTimeout * 3);

        expect(
          subject.calls.length,
          atDecay,
          reason: 'a screen nobody is looking at must not poll forever',
        );
        expect(subject.policy.isPolling, isFalse);

        subject.policy.dispose();
      });
    });

    test('markActive() resets the idle countdown and keeps polling', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();

        // Sit just short of decay, then interact.
        async.elapse(
          HouseholdSyncPolicy.defaultIdleTimeout -
              HouseholdSyncPolicy.defaultPollInterval,
        );
        expect(subject.policy.isPolling, isTrue);
        subject.policy.markActive();

        // Another almost-full idle window: still alive because the clock reset.
        async.elapse(
          HouseholdSyncPolicy.defaultIdleTimeout -
              HouseholdSyncPolicy.defaultPollInterval,
        );

        expect(subject.policy.isPolling, isTrue);
        subject.policy.dispose();
      });
    });

    test('markActive() on a decayed policy revives the cadence', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        async.elapse(HouseholdSyncPolicy.defaultIdleTimeout * 2);
        expect(subject.policy.isPolling, isFalse);
        final int whileDecayed = subject.calls.length;

        subject.policy.markActive();
        async.elapse(HouseholdSyncPolicy.defaultPollInterval);

        expect(subject.calls.length, greaterThan(whileDecayed));
        expect(subject.policy.isPolling, isTrue);

        subject.policy.dispose();
      });
    });
  });

  group('HouseholdSyncPolicy — app lifecycle', () {
    test('resumed refetches immediately and revives a decayed policy', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        async.elapse(HouseholdSyncPolicy.defaultIdleTimeout * 2);
        expect(subject.policy.isPolling, isFalse);
        final int beforeResume = subject.calls.length;

        subject.policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.flushMicrotasks();

        expect(
          subject.calls.length,
          beforeResume + 1,
          reason: 'the household may have changed while backgrounded',
        );
        expect(subject.policy.isPolling, isTrue);

        subject.policy.dispose();
      });
    });

    test('paused stops the cadence — a backgrounded app must not poll', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        subject.policy.onLifecycleChanged(AppLifecycleState.paused);
        final int whilePaused = subject.calls.length;

        async.elapse(HouseholdSyncPolicy.defaultPollInterval * 4);

        expect(subject.calls.length, whilePaused);
        expect(subject.policy.isPolling, isFalse);

        subject.policy.dispose();
      });
    });

    test('a lifecycle change before start() does not begin polling', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.elapse(HouseholdSyncPolicy.defaultPollInterval * 3);

        expect(
          subject.calls,
          isEmpty,
          reason: 'a policy that was never started owns no screen to refresh',
        );

        subject.policy.dispose();
      });
    });
  });

  group('HouseholdSyncPolicy — overlap and teardown', () {
    test('a slow refetch is never overlapped by the next tick', () {
      fakeAsync((FakeAsync async) {
        int started = 0;
        int finished = 0;
        final HouseholdSyncPolicy policy = HouseholdSyncPolicy(
          refetch: () async {
            started++;
            // Three times the poll interval: without in-flight suppression
            // this would pile requests onto a cold Aurora instance.
            await Future<void>.delayed(
              HouseholdSyncPolicy.defaultPollInterval * 3,
            );
            finished++;
          },
        );

        policy.start();
        async.elapse(HouseholdSyncPolicy.defaultPollInterval * 2);

        expect(started, 1);
        expect(finished, 0);

        policy.dispose();
      });
    });

    test('a refetch that throws does not kill the cadence', () {
      fakeAsync((FakeAsync async) {
        int calls = 0;
        final HouseholdSyncPolicy policy = HouseholdSyncPolicy(
          refetch: () async {
            calls++;
            throw StateError('network down');
          },
        );

        policy.start();
        async.flushMicrotasks();
        async.elapse(HouseholdSyncPolicy.defaultPollInterval * 2);

        expect(
          calls,
          3,
          reason: 'a poll is best-effort; one failure must not stop the rest',
        );

        policy.dispose();
      });
    });

    test('dispose() stops everything and makes further calls inert', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        subject.policy.dispose();
        final int atDispose = subject.calls.length;

        subject.policy.start();
        subject.policy.markActive();
        subject.policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.elapse(HouseholdSyncPolicy.defaultPollInterval * 5);

        expect(subject.calls.length, atDispose);
        expect(subject.policy.isPolling, isFalse);
      });
    });
  });
}
