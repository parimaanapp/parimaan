import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/tokens.dart';
import '../domain/ai_recipe_draft.dart';
import '../state/url_import_controller.dart';
import 'recipes_error_copy.dart';

/// Wireframe 8.3 — a URL field with a paste-from-clipboard affordance, an
/// honest in-flight state (this can take several seconds, and Aurora is
/// not even in the path — a spinner with no explanation is where users
/// assume it's broken), and, per D10's locked call (§13.5.12, S1 landed
/// 14/20 usable drafts — the middle tier), a **co-equal** "paste the text
/// instead" affordance rendered at all times, not buried behind a failure —
/// ~30% of real pasted URLs won't produce a usable draft.
///
/// Submit calls `Mutation.importRecipeFromUrl` via [UrlImportController].
/// On success, pushes the shared review screen (W7 S10) with the parsed
/// [AiRecipeDraft] and `sourceUrl` set. On failure, `URL_UNREADABLE` (the
/// only code this resolver ever actually throws, §13.2.10 — no draft was
/// ever extracted, so there is nothing to retry with the same URL) routes
/// to the AI failure fallback screen (W7 S11, minimal placeholder for now)
/// with the URL preserved; every other code renders inline, with a retry
/// affordance except for `RateLimitedError` (retrying immediately can't
/// succeed) — the identical policy `FreeformInputScreen` (W7 S10) already
/// established for `parseFreeformRecipe`'s own failures.
class UrlImportScreen extends ConsumerStatefulWidget {
  const UrlImportScreen({super.key, required this.householdId});

  final String householdId;

  static const Key urlFieldKey = Key('url-import-field');
  static const Key pasteButtonKey = Key('url-import-paste');
  static const Key submitButtonKey = Key('url-import-submit');
  static const Key retryButtonKey = Key('url-import-retry');
  static const Key pasteInsteadButtonKey = Key('url-import-paste-instead');
  static const Key inFlightIndicatorKey = Key('url-import-in-flight');

  @override
  ConsumerState<UrlImportScreen> createState() => _UrlImportScreenState();
}

class _UrlImportScreenState extends ConsumerState<UrlImportScreen> {
  final TextEditingController _url = TextEditingController();

  /// Set by [PopScope.onPopInvokedWithResult] in [build] the moment this
  /// route actually pops — **not** the same as `!mounted`. A route's exit
  /// transition keeps its widget (and `mounted`) alive for the duration of
  /// the animation, so a slow in-flight `_submit()` whose `import()` call
  /// happens to resolve mid-transition would still see `mounted == true`
  /// and push the review screen *on top of* wherever the user backed out
  /// to — "stays cancellable" (§13.3 S9's own RED test) means backing out
  /// actually cancels the pending navigation, not just that a back
  /// affordance remains tappable. Routed through `PopScope`, not just the
  /// top bar's own `onBack`, so this covers every way the route can pop —
  /// the in-app button, Android's hardware/gesture back, and iOS's
  /// edge-swipe alike.
  bool _cancelled = false;

  @override
  void initState() {
    super.initState();
    _url.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  /// Cheap client-side pre-check — the server's own validation is
  /// authoritative (`api/src/validation/importRecipeFromUrl.ts`); this only
  /// saves a round trip for an obviously-not-a-URL input.
  bool get _isValidHttpsUrl {
    final String trimmed = _url.text.trim();
    if (trimmed.isEmpty) {
      return false;
    }
    final Uri? parsed = Uri.tryParse(trimmed);
    return parsed != null && parsed.scheme == 'https' && parsed.host.isNotEmpty;
  }

  Future<void> _pasteFromClipboard() async {
    final ClipboardData? data = await Clipboard.getData(Clipboard.kTextPlain);
    // The screen (and `_url` with it) may have been popped while the
    // platform-channel read was in flight — writing to a disposed
    // `TextEditingController`, or triggering `setState` after unmount via
    // its listener, would both throw.
    if (!mounted) {
      return;
    }
    final String? text = data?.text;
    if (text != null && text.trim().isNotEmpty) {
      _url.text = text.trim();
    }
  }

  Future<void> _submit() async {
    final AiRecipeDraft? draft = await ref
        .read(urlImportControllerProvider.notifier)
        .import(_url.text.trim());
    if (!mounted || _cancelled) {
      return;
    }
    if (draft != null) {
      context.push(
        AppRoutes.recipeDraftReview(widget.householdId),
        extra: (draft: draft, sourceUrl: _url.text.trim()),
      );
      return;
    }
    final Object? error = ref.read(urlImportControllerProvider).error;
    if (error is UrlUnreadableError) {
      context.push(
        AppRoutes.recipeAiFailure(widget.householdId),
        extra: (
          errorMessage: error.errorMessage,
          preservedInput: _url.text.trim(),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AiRecipeDraft?> importState = ref.watch(
      urlImportControllerProvider,
    );
    final bool isBusy = importState.isLoading;
    final Object? error = importState.error;
    final String? errorMessage = error is UrlUnreadableError
        ? null // routed to the fallback screen instead — see _submit.
        : recipeErrorMessage(error);
    final bool offerRetry = errorMessage != null && error is! RateLimitedError;

    return PopScope(
      // Catches every way this route can pop — the in-app top-bar button
      // below, Android's hardware/gesture back, and iOS's edge-swipe — not
      // just the one `onBack` itself triggers. `_cancelled`'s own doc
      // explains why a single explicit flag beats relying on `mounted`
      // alone; this is what makes that flag actually complete rather than
      // covering only one of several real pop paths.
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
                title: 'Import from a link',
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
                        'Paste a link to a recipe and Parimaan will read it '
                        'for you. This can take a few seconds.',
                        style: AppTypography.body.copyWith(
                          color: AppColors.inkMid,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s2),
                      PInput(
                        key: UrlImportScreen.urlFieldKey,
                        label: 'Recipe URL',
                        hintText: 'https://example.com/recipe',
                        controller: _url,
                        enabled: !isBusy,
                        keyboardType: TextInputType.url,
                        trailing: PIconButton(
                          key: UrlImportScreen.pasteButtonKey,
                          icon: Icons.content_paste,
                          semanticLabel: 'Paste from clipboard',
                          onPressed: isBusy ? null : _pasteFromClipboard,
                        ),
                      ),
                      if (isBusy) ...<Widget>[
                        const SizedBox(height: AppSpacing.s2),
                        Row(
                          children: <Widget>[
                            const SizedBox(
                              key: UrlImportScreen.inFlightIndicatorKey,
                              width: AppSizing.icon16,
                              height: AppSizing.icon16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            const SizedBox(width: AppSpacing.s1),
                            Expanded(
                              child: Text(
                                'Reading the page — this can take several '
                                'seconds.',
                                style: AppTypography.label.copyWith(
                                  color: AppColors.inkMid,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
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
                            key: UrlImportScreen.retryButtonKey,
                            label: 'Try again',
                            variant: PButtonVariant.secondary,
                            onPressed: _isValidHttpsUrl ? _submit : null,
                          ),
                        ],
                      ],
                      const SizedBox(height: AppSpacing.s3),
                      PButton(
                        key: UrlImportScreen.submitButtonKey,
                        label: 'Import',
                        isLoading: isBusy,
                        expand: true,
                        onPressed: _isValidHttpsUrl && !isBusy ? _submit : null,
                      ),
                      const SizedBox(height: AppSpacing.s2),
                      // D10 (§13.5.12): equal visual prominence with the URL
                      // field above, not a buried fallback link.
                      PButton(
                        key: UrlImportScreen.pasteInsteadButtonKey,
                        label: 'Paste the recipe text instead',
                        variant: PButtonVariant.secondary,
                        expand: true,
                        onPressed: isBusy
                            ? null
                            : () => context.push(
                                AppRoutes.recipeFreeformInput(
                                  widget.householdId,
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
