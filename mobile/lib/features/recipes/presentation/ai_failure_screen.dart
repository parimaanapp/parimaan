import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/tokens.dart';

/// Wireframe 12.1 — **minimal, real placeholder for W7 S11**, reached today
/// only from S9's `URL_UNREADABLE` case (§13.2.7: not retryable with the
/// same URL, and no draft was ever extracted). Same "real route, real
/// minimal action, not a dead end" shape S8 already established for
/// `UrlImportScreen`/`FreeformInputScreen` before their own slices landed —
/// **S11 replaces this file's contents**, not its route, with the full
/// six-code-differentiated design (`AI_BUSY`/`AI_TIMEOUT`'s own retry
/// affordance, "enter manually" seeded with whatever *was* partially
/// extractable rather than always empty, an unknown-future-code fallback).
///
/// The contract this minimal version already satisfies, per §13.2.7's own
/// framing ("the fallback screen's job is to not lose the user's work"):
/// [preservedInput] is shown, never discarded, and "Enter details manually"
/// opens a real (empty, since nothing was extracted on the `URL_UNREADABLE`
/// path) `RecipeFormScreen` rather than a TODO.
class AiFailureScreen extends StatelessWidget {
  const AiFailureScreen({
    super.key,
    required this.householdId,
    required this.errorMessage,
    required this.preservedInput,
    this.inputLabel = 'URL',
  });

  final String householdId;

  /// The server's own client-safe copy for whichever code sent the user
  /// here — passed straight through, not re-worded per code (that
  /// differentiation is S11's own job).
  final String errorMessage;

  /// The URL (or, once S11/S10 wire the freeform path through here too,
  /// the pasted text) that produced [errorMessage] — never discarded.
  final String preservedInput;

  final String inputLabel;

  static const Key preservedInputKey = Key('ai-failure-preserved-input');
  static const Key manualEntryButtonKey = Key('ai-failure-manual-entry');
  static const Key pasteInsteadButtonKey = Key('ai-failure-paste-instead');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: "Couldn't import that recipe",
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
                    errorMessage,
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
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
