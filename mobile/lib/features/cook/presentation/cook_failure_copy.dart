import '../../../shared/errors/app_error.dart';

/// What the user can do from a "what can I cook?" dead end (W21 S5): the
/// pantry was too small, nothing came back grounded, or a real failure.
/// The FIRST action is the primary one, matching `PhotoFailureCopy`'s own
/// "one primary action, no dead ends" rule from W20 S6.
enum CookFailureAction { retry, differentVibe, addManually }

class CookFailureCopy {
  const CookFailureCopy({
    required this.headline,
    required this.body,
    required this.actions,
  });

  final String headline;
  final String body;

  /// Ordered; `actions.first` is the primary. Never empty.
  final List<CookFailureAction> actions;
}

/// The pantry doesn't have enough real ingredients yet (D6) — a fact about
/// the pantry, not a failure, so there is no "try again": adding something
/// is the only thing that changes the answer.
const CookFailureCopy emptyPantryCopy = CookFailureCopy(
  headline: "Your pantry's looking a little bare",
  body: "Add a few things you have — dal, rice, some vegetables — and we'll suggest what you can make.",
  actions: <CookFailureAction>[CookFailureAction.addManually],
);

/// The model's ideas didn't fit this pantry or this household's rules
/// (grounding or the skip/dietary filters dropped everything). Changing the
/// vibe is the one lever that plausibly helps, so it leads.
const CookFailureCopy noGroundedCopy = CookFailureCopy(
  headline: "Couldn't find a good match this time",
  body: 'Try a different vibe, or add a few more things to your pantry.',
  actions: <CookFailureAction>[
    CookFailureAction.differentVibe,
    CookFailureAction.addManually,
  ],
);

/// Copy for every way the request can fail. Voice per the brand bible:
/// second person, plain, no alarm. Deliberately an exhaustive `switch` over
/// the sealed [AppError] so a new subtype is a compile error here, not a
/// silent fall into a generic message. "Add manually" is offered from every
/// screen: cook-from-pantry is a convenience, never the only way to a recipe.
CookFailureCopy cookFailureCopy(AppError error) => switch (error) {
  AiTimeoutError() => const CookFailureCopy(
    headline: 'That took too long',
    body:
        'Reading your pantry is taking longer than usual. Give it another go.',
    actions: <CookFailureAction>[
      CookFailureAction.retry,
      CookFailureAction.addManually,
    ],
  ),
  AiBusyError() => const CookFailureCopy(
    headline: 'The recipe finder is busy',
    body: 'Give it another moment and try again.',
    actions: <CookFailureAction>[
      CookFailureAction.retry,
      CookFailureAction.addManually,
    ],
  ),
  RateLimitedError(:final String errorMessage) => CookFailureCopy(
    headline: "That's enough ideas for today",
    body: errorMessage,
    actions: const <CookFailureAction>[CookFailureAction.addManually],
  ),
  AiUnparseableError() || AiUnavailableError() => const CookFailureCopy(
    headline: "Cooking suggestions aren't working right now",
    body: 'Add what you want to cook yourself for now.',
    actions: <CookFailureAction>[CookFailureAction.addManually],
  ),
  UnauthorizedError() => const CookFailureCopy(
    headline: 'Your session has expired',
    body: 'Sign in again to keep going.',
    actions: <CookFailureAction>[CookFailureAction.addManually],
  ),
  NotFoundError() || InternalError() => const CookFailureCopy(
    headline: "That didn't come through",
    body: 'Check your connection and try again.',
    actions: <CookFailureAction>[
      CookFailureAction.retry,
      CookFailureAction.addManually,
    ],
  ),
  ForbiddenError() ||
  ConflictError() ||
  HouseholdFullError() ||
  ValidationError() ||
  UrlUnreadableError() ||
  PhotoUploadError() => const CookFailureCopy(
    headline: "Couldn't get suggestions just now",
    body: 'Add what you want to cook yourself for now.',
    actions: <CookFailureAction>[CookFailureAction.addManually],
  ),
};
