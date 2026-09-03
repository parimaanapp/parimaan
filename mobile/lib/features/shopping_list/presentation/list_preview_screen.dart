import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../domain/shopping_list_item.dart';
import '../state/current_shopping_list_controller.dart';
import 'checklist_item.dart';

/// Wireframe "List preview" (36/49, E2E_MVP_PLAN.md §17.1/§17.3 S6) — the
/// categorized preview of a freshly generated shopping list.
///
/// Watching [currentShoppingListControllerProvider] here IS the trigger for
/// the real `generateShoppingList` call — `CurrentShoppingListController.build`
/// calls it directly the first time any widget reads this family member for
/// [ShoppingListFlowExtra.menuId] (that controller's own doc). This screen
/// itself never calls `generateShoppingList` — it only ever reads the
/// controller, same "the write happens where the family key is watched, not
/// in an imperative call site" shape `AutoFillPreviewScreen` uses for its own
/// read-only `previewAutoFill`.
class ListPreviewScreen extends ConsumerStatefulWidget {
  const ListPreviewScreen({super.key, required this.extra});

  final ShoppingListFlowExtra extra;

  static const Key loadingKey = Key('shopping-list-preview-loading');
  static const Key errorKey = Key('shopping-list-preview-error');
  static const Key emptyKey = Key('shopping-list-preview-empty');
  static const Key doneButtonKey = Key('shopping-list-preview-done');

  @override
  ConsumerState<ListPreviewScreen> createState() => _ListPreviewScreenState();
}

class _ListPreviewScreenState extends ConsumerState<ListPreviewScreen> {
  /// Guards the [ConflictError] redirect below to fire at most once per
  /// screen instance — without it, `build()` re-running for any OTHER
  /// reason while still in the conflict state (a parent rebuild, a
  /// hot-reload, ...) would schedule a redundant `context.go` every time
  /// (`code-reviewer` finding, W11 S6 review: harmless in practice since
  /// `go()` to an unchanged location is a no-op, but not obviously so —
  /// this makes "redirect exactly once" the actual guarantee, not an
  /// incidental one).
  bool _redirectedOnConflict = false;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<ShoppingList> list = ref.watch(
      currentShoppingListControllerProvider(widget.extra.menuId),
    );

    // A `ConflictError` here means an open list ALREADY exists for this
    // `menuId` — the expected outcome of re-entering this flow for a week
    // that was already generated (e.g. backgrounding the app mid-flow, then
    // tapping "Generate shopping list" again from `WeeklyPlanScreen`).
    // `generateShoppingList` refuses a second call by design
    // (`ShoppingListRepository`'s own doc), so retrying THIS screen's own
    // call would fail identically every time. Scheduled via a post-frame
    // callback (never called straight from `build`) so it works whether
    // this is a fresh transition into the error OR the controller was
    // ALREADY resolved to it before this screen mounted — routes to the
    // persistent [ShoppingListScreen] instead, which at least puts the
    // user on the one durable screen meant to answer "what's on my list,"
    // rather than a transient one-shot preview screen framed around
    // building a NEW list (`flutter-reviewer` finding, W11 S6 review).
    // NOTE, not silently papered over: [ShoppingListScreen]'s own error
    // state cannot fully recover the real list either this week — see that
    // screen's own doc comment for exactly why, and what closes the gap.
    if (list.hasError &&
        list.error is ConflictError &&
        !_redirectedOnConflict) {
      _redirectedOnConflict = true;
      WidgetsBinding.instance.addPostFrameCallback((Duration _) {
        if (context.mounted) {
          context.go(AppRoutes.shoppingList, extra: widget.extra.menuId);
        }
      });
    }

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'List preview',
              onBack: () => context.pop(),
              backSemanticLabel: 'Back',
            ),
            Expanded(
              child: switch ((list.valueOrNull, list.hasError)) {
                (final ShoppingList value, _) => _Loaded(
                  list: value,
                  onDone: () => context.push(
                    AppRoutes.shoppingListNotificationPrompt,
                    extra: widget.extra,
                  ),
                ),
                // A `ConflictError` is about to redirect away (the
                // post-frame callback above) — rendered as the loading
                // state, never the error one, so there is no flash of a
                // retry-doomed "Try again" button on the way out.
                (null, true) when list.error is ConflictError => const Center(
                  key: ListPreviewScreen.loadingKey,
                  child: CircularProgressIndicator(),
                ),
                (null, true) => Center(
                  key: ListPreviewScreen.errorKey,
                  child: PEmptyState(
                    headline: 'Could not build your shopping list',
                    body: list.error is AppError
                        ? (list.error! as AppError).errorMessage
                        : 'Something went wrong. Please try again.',
                    action: PButton(
                      label: 'Try again',
                      variant: PButtonVariant.secondary,
                      onPressed: () => ref.invalidate(
                        currentShoppingListControllerProvider(
                          widget.extra.menuId,
                        ),
                      ),
                    ),
                  ),
                ),
                _ => const Center(
                  key: ListPreviewScreen.loadingKey,
                  child: CircularProgressIndicator(),
                ),
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Loaded extends StatelessWidget {
  const _Loaded({required this.list, required this.onDone});

  final ShoppingList list;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    if (list.items.isEmpty) {
      return Center(
        key: ListPreviewScreen.emptyKey,
        child: PEmptyState(
          headline: 'Nothing to buy this week.',
          body:
              'Every ingredient on this week\'s menu is already a staple you '
              'keep on hand.',
          action: PButton(
            key: ListPreviewScreen.doneButtonKey,
            label: 'Done',
            onPressed: onDone,
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Expanded(child: CategorizedChecklist(items: list.items)),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.s3),
          child: PButton(
            key: ListPreviewScreen.doneButtonKey,
            label: 'Done',
            onPressed: onDone,
          ),
        ),
      ],
    );
  }
}
