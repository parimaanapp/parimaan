import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/presentation/cook_failure_copy.dart';
import 'package:mobile/shared/errors/app_error.dart';

void main() {
  test('emptyPantryCopy leads with add manually, no retry (D6 — a fact about the pantry, not a failure)', () {
    expect(emptyPantryCopy.headline, isNotEmpty);
    expect(emptyPantryCopy.actions.first, CookFailureAction.addManually);
    expect(emptyPantryCopy.actions, isNot(contains(CookFailureAction.retry)));
  });

  test('noGroundedCopy leads with a different vibe, over add manually', () {
    expect(noGroundedCopy.actions.first, CookFailureAction.differentVibe);
    expect(noGroundedCopy.actions, contains(CookFailureAction.addManually));
  });

  group('cookFailureCopy — exhaustive over AppError', () {
    test('a retryable failure (timeout/busy) offers retry first', () {
      for (final AppError error in <AppError>[
        const AiTimeoutError('slow'),
        const AiBusyError('busy'),
      ]) {
        final CookFailureCopy copy = cookFailureCopy(error);
        expect(copy.actions.first, CookFailureAction.retry);
        expect(copy.headline, isNotEmpty);
      }
    });

    test('the daily limit offers only add manually, with the server message as the body', () {
      const RateLimitedError error = RateLimitedError(
        "You've asked for ideas 10 times today — that's the daily limit. Your saved recipes are all still here.",
      );
      final CookFailureCopy copy = cookFailureCopy(error);
      expect(copy.actions, <CookFailureAction>[CookFailureAction.addManually]);
      expect(copy.body, error.errorMessage);
    });

    test('an answer the model cannot produce, or the service being unavailable, offers add manually first (not retry)', () {
      for (final AppError error in <AppError>[
        const AiUnparseableError('bad'),
        const AiUnavailableError('down'),
        const ForbiddenError('no'),
      ]) {
        expect(
          cookFailureCopy(error).actions.first,
          CookFailureAction.addManually,
        );
      }
    });

    test('a connection hiccup (not found / internal) is retryable, matching CookSuggestionsController.canRetry', () {
      for (final AppError error in <AppError>[
        const NotFoundError('gone'),
        const InternalError('boom'),
      ]) {
        expect(cookFailureCopy(error).actions.first, CookFailureAction.retry);
        expect(
          cookFailureCopy(error).actions,
          contains(CookFailureAction.addManually),
        );
      }
    });
  });
}
