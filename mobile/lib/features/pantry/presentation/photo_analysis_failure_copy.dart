import '../../../shared/errors/app_error.dart';

/// What the user can do from a photo dead end (W20 S6). The FIRST action in a
/// [PhotoFailureCopy.actions] list is the primary one — the design system's
/// empty states carry "one primary action, no dead ends".
enum PhotoFailureAction { retry, retake, addManually }

class PhotoFailureCopy {
  const PhotoFailureCopy({required this.headline, required this.body, required this.actions});

  final String headline;
  final String body;

  /// Ordered; `actions.first` is the primary. Never empty.
  final List<PhotoFailureAction> actions;
}

/// "Nothing identifiable" — about 1 in 10 of W19's real photos. A normal
/// answer, so it coaches instead of blaming (brand: "quietly organized",
/// never "you did it wrong"), and repeats the tips screen's advice.
const PhotoFailureCopy emptyPhotoCopy = PhotoFailureCopy(
  headline: "Couldn't make out this shelf",
  body: 'Try one shelf at a time, with the labels facing you and the light on. Or add things yourself.',
  actions: <PhotoFailureAction>[PhotoFailureAction.retake, PhotoFailureAction.addManually],
);

/// Copy for every way the photo path can fail. Voice per the brand bible:
/// second person, plain, no alarm and no apology ("Errors explain what went
/// wrong and how to fix it"). Deliberately an exhaustive `switch` over the
/// sealed [AppError] so a new subtype is a compile error here, not a
/// silent fall into a generic message. "Add manually" is offered from every
/// screen: the photo path is a convenience, never a trap.
PhotoFailureCopy photoFailureCopy(AppError error) => switch (error) {
  AiTimeoutError() => const PhotoFailureCopy(
    headline: 'That took too long',
    body: 'Reading the photo is taking longer than usual. Give it another go.',
    actions: <PhotoFailureAction>[PhotoFailureAction.retry, PhotoFailureAction.retake, PhotoFailureAction.addManually],
  ),
  AiBusyError() => const PhotoFailureCopy(
    headline: 'The photo reader is busy',
    body: 'Give it a moment, then try again.',
    actions: <PhotoFailureAction>[PhotoFailureAction.retry, PhotoFailureAction.retake, PhotoFailureAction.addManually],
  ),
  PhotoUploadError() || InternalError() => const PhotoFailureCopy(
    headline: "Couldn't send the photo",
    body: 'Check your connection and try again.',
    actions: <PhotoFailureAction>[PhotoFailureAction.retry, PhotoFailureAction.retake, PhotoFailureAction.addManually],
  ),
  NotFoundError() => const PhotoFailureCopy(
    headline: "That photo didn't make it",
    body: "It didn't reach us. Try sending it again.",
    actions: <PhotoFailureAction>[PhotoFailureAction.retry, PhotoFailureAction.retake, PhotoFailureAction.addManually],
  ),
  RateLimitedError(:final String errorMessage) => PhotoFailureCopy(
    headline: "That's enough photos for today",
    // The server's own sentence states the real limit; it is written to be shown.
    body: errorMessage,
    actions: const <PhotoFailureAction>[PhotoFailureAction.addManually],
  ),
  ValidationError() => const PhotoFailureCopy(
    headline: "That photo didn't work",
    body: 'Try taking it again — one shelf, labels facing you.',
    actions: <PhotoFailureAction>[PhotoFailureAction.retake, PhotoFailureAction.addManually],
  ),
  AiUnparseableError() => const PhotoFailureCopy(
    headline: "Couldn't read that one",
    body: 'A fresh photo might do it — one shelf, labels facing you.',
    actions: <PhotoFailureAction>[PhotoFailureAction.retake, PhotoFailureAction.addManually],
  ),
  AiUnavailableError() ||
  ForbiddenError() ||
  UnauthorizedError() ||
  ConflictError() ||
  HouseholdFullError() ||
  UrlUnreadableError() => const PhotoFailureCopy(
    headline: "Photo reading isn't working right now",
    body: 'You can add things yourself for now, or try a fresh photo later.',
    actions: <PhotoFailureAction>[PhotoFailureAction.addManually, PhotoFailureAction.retake],
  ),
};
