import 'package:fake_async/fake_async.dart';
import 'package:flutter/widgets.dart' show AppLifecycleState;
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/state/household_sync_policy.dart';

/// Builds a policy plus the counter its refetch increments. Every test
/// drives this inside `fakeAsync` even though there is no cadence left to
/// fake time for — it is what lets a "no timer was ever armed" assertion be
/// made with confidence (`async.elapse` would surface one if it existed),
/// and it keeps this file's shape consistent with the class's own
/// pre-W8-S10 test suite for anyone diffing the two.
({HouseholdSyncPolicy policy, List<int> calls}) _subject() {
  final List<int> calls = <int>[];
  final HouseholdSyncPolicy policy = HouseholdSyncPolicy(
    refetch: () async => calls.add(calls.length),
  );
  return (policy: policy, calls: calls);
}

void main() {
  group('HouseholdSyncPolicy — route entry', () {
    test('start() refetches immediately', () {
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

    test('a second start() once the first has settled refetches again — each call is a genuine route entry', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        subject.policy.start();
        async.flushMicrotasks();

        expect(subject.calls, hasLength(2));

        subject.policy.dispose();
      });
    });

    test('two start() calls back-to-back overlap into one in-flight refetch, not two concurrent ones', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        // Both calls land before the first refetch has had a chance to
        // settle — the in-flight guard (shared with the overlap-protection
        // tests below) means the second is suppressed rather than firing a
        // concurrent second request.
        subject.policy.start();
        subject.policy.start();
        async.flushMicrotasks();

        expect(subject.calls, hasLength(1));

        subject.policy.dispose();
      });
    });
  });

  group('HouseholdSyncPolicy — no poll cadence (W8 S10 retirement)', () {
    test('no timer is ever armed — waiting does not trigger any further refetch', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        final int afterStart = subject.calls.length;

        // A long wait with nothing else happening. Pre-W8-S10 this class
        // would have polled repeatedly across this window; now the only way
        // `calls` grows is another explicit start()/resumed trigger.
        async.elapse(const Duration(hours: 6));

        expect(
          subject.calls.length,
          afterStart,
          reason: 'onHouseholdChanged replaces polling — this class no longer arms a Timer at all',
        );

        subject.policy.dispose();
      });
    });

    test('stop() is a harmless no-op — there is no cadence left for it to end', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();

        expect(() => subject.policy.stop(), returnsNormally);
        expect(subject.calls, hasLength(1), reason: 'stop() itself never refetches');

        subject.policy.dispose();
      });
    });
  });

  group('HouseholdSyncPolicy — app lifecycle', () {
    test('resumed refetches immediately for a started policy', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        final int beforeResume = subject.calls.length;

        subject.policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.flushMicrotasks();

        expect(
          subject.calls.length,
          beforeResume + 1,
          reason: 'the household may have changed while backgrounded',
        );

        subject.policy.dispose();
      });
    });

    test('paused does not refetch — there is no cadence for it to stop', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        final int beforePause = subject.calls.length;

        subject.policy.onLifecycleChanged(AppLifecycleState.paused);
        async.flushMicrotasks();

        expect(subject.calls.length, beforePause);

        subject.policy.dispose();
      });
    });

    test('a resumed event before start() does not refetch — the policy owns no screen yet', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.flushMicrotasks();

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
    test('a slow refetch suppresses an overlapping one from firing concurrently', () {
      fakeAsync((FakeAsync async) {
        int started = 0;
        int finished = 0;
        final HouseholdSyncPolicy policy = HouseholdSyncPolicy(
          refetch: () async {
            started++;
            await Future<void>.delayed(const Duration(seconds: 5));
            finished++;
          },
        );

        policy.start();
        // A resumed event lands while the first refetch is still in flight.
        policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.flushMicrotasks();

        expect(started, 1, reason: 'the in-flight guard suppresses the overlapping trigger');
        expect(finished, 0);

        async.elapse(const Duration(seconds: 5));
        policy.dispose();
      });
    });

    test('a refetch that throws does not break a later trigger', () {
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
        policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.flushMicrotasks();

        expect(
          calls,
          2,
          reason: 'a refetch is best-effort; one failure must not stop the next trigger',
        );

        policy.dispose();
      });
    });

    test('dispose() makes further calls inert', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();

        subject.policy.start();
        async.flushMicrotasks();
        subject.policy.dispose();
        final int atDispose = subject.calls.length;

        subject.policy.start();
        subject.policy.onLifecycleChanged(AppLifecycleState.resumed);
        async.flushMicrotasks();

        expect(subject.calls.length, atDispose);
      });
    });
  });
}
