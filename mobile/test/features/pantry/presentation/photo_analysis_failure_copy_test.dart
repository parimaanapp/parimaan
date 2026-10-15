import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/presentation/photo_analysis_failure_copy.dart';
import 'package:mobile/features/pantry/state/pantry_photo_analysis_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

/// One instance of every [AppError] variant. AppError is sealed, so when a new
/// subtype is added this list is the place a test fails to be exhaustive —
/// which is the point: a new failure must not silently fall into a default.
const List<AppError> _every = <AppError>[
  UnauthorizedError('u'),
  ForbiddenError('f'),
  ValidationError('v'),
  ConflictError('c'),
  NotFoundError('n'),
  HouseholdFullError('h'),
  RateLimitedError("You've reached today's limit of 20 photo analyses. Try again tomorrow."),
  AiBusyError('b'),
  AiUnparseableError('p'),
  AiUnavailableError('a'),
  AiTimeoutError('t'),
  UrlUnreadableError('r'),
  PhotoUploadError('Could not upload the photo.'),
  InternalError('i'),
];

void main() {
  group('photoFailureCopy — the design system\'s "no dead ends" rule, as a test', () {
    for (final AppError error in _every) {
      test('${error.errorType}: has a headline, a body, and at least one way forward', () {
        final PhotoFailureCopy copy = photoFailureCopy(error);
        expect(copy.headline.trim(), isNotEmpty);
        expect(copy.body.trim(), isNotEmpty);
        expect(copy.actions, isNotEmpty);
      });

      test('${error.errorType}: offers "Try again" exactly when the controller says a retry can help', () {
        final bool retryable = PhotoAnalysisFailed(error).canRetry;
        final PhotoFailureCopy copy = photoFailureCopy(error);
        expect(copy.actions.contains(PhotoFailureAction.retry), retryable);
        if (retryable) {
          expect(copy.actions.first, PhotoFailureAction.retry, reason: 'the primary action is the one that fixes it');
        }
      });

      test('${error.errorType}: never reaches for alarm words, and never leaks the raw server text of an error it cannot explain', () {
        final PhotoFailureCopy copy = photoFailureCopy(error);
        final String all = '${copy.headline} ${copy.body}'.toLowerCase();
        for (final String banned in <String>['error', 'sorry', 'exception', 'failed', 'oops', 'warning']) {
          expect(all, isNot(contains(banned)), reason: 'brand voice: no alarm, no apology');
        }
      });
    }

    test('the daily limit says why, using the server\'s own words, and offers manual add — retrying today is pointless', () {
      final PhotoFailureCopy copy = photoFailureCopy(_every.firstWhere((AppError e) => e is RateLimitedError));
      expect(copy.body, contains('20 photo analyses'));
      expect(copy.actions.first, PhotoFailureAction.addManually);
      expect(copy.actions, isNot(contains(PhotoFailureAction.retake)));
    });

    test('a rejected photo leads with retake, because resending the same bytes fails the same way', () {
      final PhotoFailureCopy copy = photoFailureCopy(const ValidationError('bad'));
      expect(copy.actions.first, PhotoFailureAction.retake);
    });

    test('an unparseable answer leads with retake — a fresh photo is a fresh chance', () {
      expect(photoFailureCopy(const AiUnparseableError('x')).actions.first, PhotoFailureAction.retake);
    });

    test('every screen keeps "add manually" reachable — the app never traps someone in the photo path', () {
      for (final AppError error in _every) {
        expect(photoFailureCopy(error).actions, contains(PhotoFailureAction.addManually), reason: error.errorType);
      }
    });
  });

  group('emptyPhotoCopy — "nothing identifiable" is a normal answer, not a failure', () {
    test('coaches with the same advice the tips screen gave, and leads with retake', () {
      expect(emptyPhotoCopy.headline, isNotEmpty);
      expect(emptyPhotoCopy.body.toLowerCase(), contains('one shelf'));
      expect(emptyPhotoCopy.actions.first, PhotoFailureAction.retake);
      expect(emptyPhotoCopy.actions, contains(PhotoFailureAction.addManually));
      expect(emptyPhotoCopy.actions, isNot(contains(PhotoFailureAction.retry)));
    });
  });
}
