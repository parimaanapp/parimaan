import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/state/search_debouncer.dart';

/// Same `fake_async` rationale as `household_sync_policy_test.dart`: no test
/// here waits on a real 400ms timer.
({SearchDebouncer debouncer, List<String?> settled}) _subject({
  Duration duration = SearchDebouncer.defaultDuration,
}) {
  final List<String?> settled = <String?>[];
  final SearchDebouncer debouncer = SearchDebouncer(
    onSettled: settled.add,
    duration: duration,
  );
  return (debouncer: debouncer, settled: settled);
}

void main() {
  group('SearchDebouncer', () {
    test('does not settle before the duration elapses', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();
        subject.debouncer.update('d');
        async.elapse(const Duration(milliseconds: 399));
        expect(subject.settled, isEmpty);
        subject.debouncer.dispose();
      });
    });

    test('settles once the duration elapses', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();
        subject.debouncer.update('dal');
        async.elapse(SearchDebouncer.defaultDuration);
        expect(subject.settled, <String?>['dal']);
        subject.debouncer.dispose();
      });
    });

    test(
      'rapid keystrokes produce exactly one settle, with the final value — '
      'not one request per keystroke against a cold Aurora',
      () {
        fakeAsync((FakeAsync async) {
          final subject = _subject();
          subject.debouncer.update('d');
          async.elapse(const Duration(milliseconds: 100));
          subject.debouncer.update('da');
          async.elapse(const Duration(milliseconds: 100));
          subject.debouncer.update('dal');
          async.elapse(SearchDebouncer.defaultDuration);

          expect(subject.settled, <String?>['dal']);
          subject.debouncer.dispose();
        });
      },
    );

    test('a null value (cleared search) also debounces and settles', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();
        subject.debouncer.update('dal');
        subject.debouncer.update(null);
        async.elapse(SearchDebouncer.defaultDuration);
        expect(subject.settled, <String?>[null]);
        subject.debouncer.dispose();
      });
    });

    test('dispose cancels a pending timer — it never settles', () {
      fakeAsync((FakeAsync async) {
        final subject = _subject();
        subject.debouncer.update('dal');
        subject.debouncer.dispose();
        async.elapse(SearchDebouncer.defaultDuration);
        expect(subject.settled, isEmpty);
      });
    });
  });
}
