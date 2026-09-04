import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/state/pending_mark_made_action.dart';

/// Same `fake_async` rationale as `search_debouncer_test.dart`: no test here
/// waits on a real multi-second timer.
void main() {
  group('PendingMarkMadeAction', () {
    test('does not call onCommit before the window elapses', () {
      fakeAsync((FakeAsync async) {
        final List<String> committed = <String>[];
        PendingMarkMadeAction(
          menuItemId: 'item-1',
          onCommit: (String id) async {
            committed.add(id);
          },
          onError: (_) {},
        );

        async.elapse(
          PendingMarkMadeAction.defaultPendingWindow -
              const Duration(milliseconds: 1),
        );

        expect(committed, isEmpty);
      });
    });

    test('fires onCommit exactly once with the correct menuItemId once the '
        'window elapses uninterrupted', () {
      fakeAsync((FakeAsync async) {
        final List<String> committed = <String>[];
        PendingMarkMadeAction(
          menuItemId: 'item-42',
          onCommit: (String id) async {
            committed.add(id);
          },
          onError: (_) {},
        );

        async.elapse(PendingMarkMadeAction.defaultPendingWindow);

        expect(committed, <String>['item-42']);
      });
    });

    test(
      'cancel before the window elapses prevents onCommit from ever firing',
      () {
        fakeAsync((FakeAsync async) {
          final List<String> committed = <String>[];
          final PendingMarkMadeAction action = PendingMarkMadeAction(
            menuItemId: 'item-1',
            onCommit: (String id) async {
              committed.add(id);
            },
            onError: (_) {},
          );

          async.elapse(const Duration(seconds: 1));
          action.cancel();
          async.elapse(PendingMarkMadeAction.defaultPendingWindow);

          expect(committed, isEmpty);
          expect(action.isCancelled, isTrue);
          expect(action.isCommitted, isFalse);
        });
      },
    );

    test('cancel after the window already elapsed is a harmless no-op', () {
      fakeAsync((FakeAsync async) {
        final List<String> committed = <String>[];
        final PendingMarkMadeAction action = PendingMarkMadeAction(
          menuItemId: 'item-1',
          onCommit: (String id) async {
            committed.add(id);
          },
          onError: (_) {},
        );

        async.elapse(PendingMarkMadeAction.defaultPendingWindow);
        expect(committed, <String>['item-1']);

        // Calling cancel after the real commit already fired must not
        // throw and must not un-send anything (there is nothing left to
        // cancel by then).
        action.cancel();
        expect(committed, <String>['item-1']);
      });
    });

    test('a failed deferred onCommit reports the error via onError, exactly '
        'once', () {
      fakeAsync((FakeAsync async) {
        final List<Object> errors = <Object>[];
        final Exception failure = Exception('rejected');
        PendingMarkMadeAction(
          menuItemId: 'item-1',
          onCommit: (String id) async {
            throw failure;
          },
          onError: errors.add,
        );

        async.elapse(PendingMarkMadeAction.defaultPendingWindow);

        expect(errors, <Object>[failure]);
      });
    });

    test('a successful deferred onCommit calls onSuccess, not onError', () {
      fakeAsync((FakeAsync async) {
        final List<String> committed = <String>[];
        int successes = 0;
        final List<Object> errors = <Object>[];
        PendingMarkMadeAction(
          menuItemId: 'item-1',
          onCommit: (String id) async {
            committed.add(id);
          },
          onSuccess: () => successes++,
          onError: errors.add,
        );

        async.elapse(PendingMarkMadeAction.defaultPendingWindow);

        expect(committed, <String>['item-1']);
        expect(successes, 1);
        expect(errors, isEmpty);
      });
    });

    test('onSuccess is optional — a successful commit with none supplied '
        'does not throw', () {
      fakeAsync((FakeAsync async) {
        final List<String> committed = <String>[];
        PendingMarkMadeAction(
          menuItemId: 'item-1',
          onCommit: (String id) async {
            committed.add(id);
          },
          onError: (_) {},
        );

        async.elapse(PendingMarkMadeAction.defaultPendingWindow);

        expect(committed, <String>['item-1']);
      });
    });

    test('a custom pendingWindow overrides the default duration', () {
      fakeAsync((FakeAsync async) {
        final List<String> committed = <String>[];
        PendingMarkMadeAction(
          menuItemId: 'item-1',
          onCommit: (String id) async {
            committed.add(id);
          },
          onError: (_) {},
          pendingWindow: const Duration(seconds: 1),
        );

        async.elapse(const Duration(milliseconds: 999));
        expect(committed, isEmpty);
        async.elapse(const Duration(milliseconds: 1));
        expect(committed, <String>['item-1']);
      });
    });
  });
}
