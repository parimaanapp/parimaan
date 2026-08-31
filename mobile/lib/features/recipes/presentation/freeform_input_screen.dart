import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/tokens.dart';
import '../../../shared/errors/app_error.dart';
import '../domain/ai_recipe_draft.dart';
import '../domain/recipe_validation.dart';
import '../state/freeform_parse_controller.dart';
import 'recipes_error_copy.dart';

/// Wireframe 8.4 — a large paste field with a live character counter
/// against the [maxFreeformRecipeTextLength] bound, a **hard client-side
/// stop** (E2E_MVP_PLAN.md §13.2.9): a user never spends a rate-limit unit
/// on input the server will reject anyway. Submit calls
/// `Mutation.parseFreeformRecipe` via [FreeformParseController]; success
/// pushes the shared review screen (S10's own "8.5") with the parsed
/// [AiRecipeDraft] as `extra`. Failure follows §13.2.7's table exactly
/// (W7 S11): `AiBusyError`/`AiTimeoutError`/`RateLimitedError`/anything
/// else render inline (retry offered except for `RateLimitedError`, where
/// retrying immediately can't succeed) — this screen's own text field is
/// already the natural place to edit and retry. `AiUnparseableError`/
/// `AiUnavailableError` are never retried, since a second call with the
/// identical text can't succeed differently, so those two route to the
/// shared AI failure fallback screen instead.
class FreeformInputScreen extends ConsumerStatefulWidget {
  const FreeformInputScreen({super.key, required this.householdId});

  final String householdId;

  static const Key textFieldKey = Key('freeform-input-text');
  static const Key counterKey = Key('freeform-input-counter');
  static const Key submitButtonKey = Key('freeform-input-submit');
  static const Key retryButtonKey = Key('freeform-input-retry');

  @override
  ConsumerState<FreeformInputScreen> createState() =>
      _FreeformInputScreenState();
}

class _FreeformInputScreenState extends ConsumerState<FreeformInputScreen> {
  final TextEditingController _text = TextEditingController();

  /// Set by [PopScope.onPopInvokedWithResult] in [build] the moment this
  /// route actually pops — **not** the same as `!mounted`. A route's exit
  /// transition keeps its widget (and `mounted`) alive for the duration of
  /// the animation, so a slow in-flight `_submit()` whose `parse()` call
  /// happens to resolve mid-transition would still see `mounted == true`
  /// and push the review screen *on top of* wherever the user backed out
  /// to. Routed through `PopScope`, not just the top bar's own `onBack`,
  /// so this covers every way the route can pop — the in-app button,
  /// Android's hardware/gesture back, and iOS's edge-swipe alike (same
  /// fix as `UrlImportScreen`'s identical race, W7 S9).
  bool _cancelled = false;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  bool get _overLimit => _text.text.length > maxFreeformRecipeTextLength;

  bool get _canSubmit => _text.text.trim().isNotEmpty && !_overLimit;

  /// §13.2.7's table: these two codes are never retried (a second call
  /// with the identical text can't succeed any differently), so they
  /// route to the fallback screen (W7 S11) rather than rendering inline
  /// with a retry button the way every other error on this screen does.
  /// The single home for that rule — [_submit] and [build] both defer to
  /// it rather than repeating the condition in two different forms.
  static bool _routesToFallback(Object? error) =>
      error is AiUnparseableError || error is AiUnavailableError;

  Future<void> _submit() async {
    final AiRecipeDraft? draft = await ref
        .read(freeformParseControllerProvider.notifier)
        .parse(_text.text);
    if (!mounted || _cancelled) {
      return;
    }
    if (draft != null) {
      context.push(
        AppRoutes.recipeDraftReview(widget.householdId),
        extra: (draft: draft, sourceUrl: null),
      );
      return;
    }
    final Object? error = ref.read(freeformParseControllerProvider).error;
    // An or-pattern, not two separate `is` checks, so `error` promotes to
    // their common `AppError` supertype instead of needing a manual `as`.
    // Must stay written as a literal pattern-match (not a call to
    // [_routesToFallback]) for that promotion to apply — [build] below,
    // which only needs a bool and not the promoted value, is the one that
    // defers to the shared helper.
    if (error case AiUnparseableError() || AiUnavailableError()) {
      context.push(
        AppRoutes.recipeAiFailure(widget.householdId),
        extra: (
          error: error,
          preservedInput: _text.text,
          inputLabel: 'Pasted text',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AiRecipeDraft?> parseState = ref.watch(
      freeformParseControllerProvider,
    );
    final bool isBusy = parseState.isLoading;
    final Object? error = parseState.error;
    // Suppress the inline message for the two codes `_submit` already
    // routed to the dedicated fallback screen — this screen stays
    // underneath that push (not replaced), so without this it would show
    // its own generic error at the same time as the fallback screen shows
    // its differentiated one.
    final String? errorMessage = _routesToFallback(error)
        ? null
        : recipeErrorMessage(error);
    // §13.2.7's table: a rate-limited caller isn't offered retry, since
    // retrying immediately cannot succeed — everything else can.
    final bool offerRetry = errorMessage != null && error is! RateLimitedError;

    return PopScope(
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) {
          _cancelled = true;
        }
      },
      child: Scaffold(
        backgroundColor: AppColors.paper,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              PTopBar(
                title: 'Paste a recipe',
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
                        'Paste a recipe from anywhere — a note, a message, a '
                        'website — and Parimaan will structure it for you.',
                        style: AppTypography.body.copyWith(
                          color: AppColors.inkMid,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s2),
                      PInput(
                        key: FreeformInputScreen.textFieldKey,
                        label: 'Recipe text',
                        controller: _text,
                        enabled: !isBusy,
                        minLines: 8,
                        maxLines: 20,
                      ),
                      const SizedBox(height: AppSpacing.s0),
                      Align(
                        alignment: Alignment.centerRight,
                        child: Text(
                          '${_text.text.length} / $maxFreeformRecipeTextLength',
                          key: FreeformInputScreen.counterKey,
                          style: AppTypography.label.copyWith(
                            color: _overLimit
                                ? AppColors.danger
                                : AppColors.inkMid,
                          ),
                        ),
                      ),
                      if (errorMessage != null) ...<Widget>[
                        const SizedBox(height: AppSpacing.s2),
                        Text(
                          errorMessage,
                          style: AppTypography.label.copyWith(
                            color: AppColors.danger,
                          ),
                        ),
                        if (offerRetry) ...<Widget>[
                          const SizedBox(height: AppSpacing.s1),
                          PButton(
                            key: FreeformInputScreen.retryButtonKey,
                            label: 'Try again',
                            variant: PButtonVariant.secondary,
                            onPressed: _canSubmit ? _submit : null,
                          ),
                        ],
                      ],
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.s3,
                  0,
                  AppSpacing.s3,
                  AppSpacing.s3,
                ),
                child: PButton(
                  key: FreeformInputScreen.submitButtonKey,
                  label: 'Parse recipe',
                  isLoading: isBusy,
                  expand: true,
                  onPressed: _canSubmit && !isBusy ? _submit : null,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
