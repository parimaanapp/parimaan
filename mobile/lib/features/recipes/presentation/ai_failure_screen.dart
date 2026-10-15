import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/tokens.dart';

/// Wireframe 12.1, and the client side of §13.2.7's error-code table.
///
/// Only ever reached for a **non-retryable** failure — `AI_BUSY`/
/// `AI_TIMEOUT` stay inline on the input screen that sent them (the text
/// isn't lost either way, and immediately retrying can succeed); this
/// screen is for the codes where retrying the identical input can't help:
/// `AiUnparseableError`/`AiUnavailableError` (from `FreeformInputScreen`'s
/// `parseFreeformRecipe`) and `UrlUnreadableError` (from
/// `UrlImportScreen`'s `importRecipeFromUrl`). Each renders its own
/// headline via [_headline] — never the bare, undifferentiated server
/// message alone — and an unrecognised future [AppError] variant still
/// degrades to a generic-but-non-blank state rather than a blank screen
/// or a raw type name.
///
/// The screen's whole point, per §13.2.7's own framing ("the fallback
/// screen's job is to not lose the user's work"): [preservedInput] is
/// shown, never discarded, and "Enter details manually" opens a real
/// `RecipeFormScreen` — empty, since none of the three codes that reach
/// this screen ever leave a partial draft behind (each means the
/// resolver's own mutation call failed outright, so there is nothing
/// server-side to seed a form from) — rather than a TODO.
///
/// **No retry affordance, by design, not by omission:** every code that
/// can reach this screen is explicitly non-retryable per §13.2.7's table.
/// Building an unused generic-retry mechanism for a hypothetical future
/// retryable-and-routed-here code would be exactly the kind of
/// speculative capability this codebase avoids — add it if/when a real
/// code needs it.
class AiFailureScreen extends StatelessWidget {
  const AiFailureScreen({
    super.key,
    required this.householdId,
    required this.error,
    required this.preservedInput,
    this.inputLabel = 'URL',
  });

  final String householdId;

  /// Whichever [AppError] sent the user here — drives [_headline]'s
  /// per-code headline, and carries the server's own client-safe message
  /// as its body copy.
  final AppError error;

  /// The URL (`UrlImportScreen`) or pasted text (`FreeformInputScreen`)
  /// that produced [error] — never discarded.
  final String preservedInput;

  final String inputLabel;

  static const Key preservedInputKey = Key('ai-failure-preserved-input');
  static const Key manualEntryButtonKey = Key('ai-failure-manual-entry');
  static const Key pasteInsteadButtonKey = Key('ai-failure-paste-instead');

  /// The headline shown above [error]'s own message — distinct per code,
  /// per §13.2.7's table (`AiUnavailableError` gets "different copy" from
  /// `AiUnparseableError` there, verbatim). Anything this build doesn't
  /// specifically recognise — a future code, or a code that reaches this
  /// screen unexpectedly — still gets an honest, non-blank headline rather
  /// than nothing.
  String get _headline => switch (error) {
    AiUnparseableError() => "Couldn't understand that recipe",
    AiUnavailableError() => "Recipe import isn't available right now",
    UrlUnreadableError() => "Couldn't read that page",
    _ => "Couldn't import that recipe",
  };

  /// "Paste the text instead" only makes sense as an *alternative* — a
  /// user who already arrived here via the freeform-paste path
  /// (`AiUnparseableError`/`AiUnavailableError`) is already on that path;
  /// offering it again would be nonsensical, not a genuine second option.
  /// Only `UrlUnreadableError` (S9's own URL-import failure) shows it.
  bool get _offerPasteInstead => error is UrlUnreadableError;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: _headline,
            onBack: () => context.pop(),
            backSemanticLabel: 'Back',
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    error.errorMessage,
                    style: AppTypography.body.copyWith(color: AppColors.ink),
                  ),
                  const SizedBox(height: AppSpacing.s2),
                  Text(
                    inputLabel.toUpperCase(),
                    style: AppTypography.meta.copyWith(
                      color: AppColors.inkMid,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s0),
                  Text(
                    preservedInput,
                    key: preservedInputKey,
                    style: AppTypography.bodyStrong.copyWith(
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s3),
                  PButton(
                    key: manualEntryButtonKey,
                    label: 'Enter details manually',
                    onPressed: () =>
                        context.push(AppRoutes.recipeCreate(householdId)),
                  ),
                  if (_offerPasteInstead) ...<Widget>[
                    const SizedBox(height: AppSpacing.s1),
                    PButton(
                      key: pasteInsteadButtonKey,
                      label: 'Paste the text instead',
                      variant: PButtonVariant.secondary,
                      onPressed: () => context.push(
                        AppRoutes.recipeFreeformInput(householdId),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
