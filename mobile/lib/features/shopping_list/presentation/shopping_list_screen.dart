import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/shopping_list_item.dart';
import '../state/current_shopping_list_controller.dart';
import 'checklist_item.dart';

/// Wireframe "Shopping List" (37-38/49, E2E_MVP_PLAN.md §17.1/§17.3 S6) —
/// the persistent, live view of the current menu's shopping list, showing
/// only what's still [ShoppingList.toBuy] — an item `haveIt` (S7) has
/// already moved to pantry drops out of this view, per that getter's own
/// doc.
///
/// `PTopBar.onBack` here goes to the Weekly plan tab, NOT `context.pop()` —
/// this screen is reached via `context.go` (replacing the flow's own pushed
/// history, per `AppRoutes.shoppingList`'s own router doc), so there is
/// nothing left on the navigator stack to pop back to; `pop()` would either
/// no-op or exit the app. Routing back to the shell explicitly is what
/// keeps this screen from being a dead end (`code-reviewer` finding, W11 S6
/// review — this screen is now also the ConflictError-redirect target from
/// `ListPreviewScreen`, making that exit more reachable than before).
///
/// **A known, named limitation, not silently papered over.**
/// `CurrentShoppingListController.build` always calls `generateShoppingList`
/// (there is no `Query.shoppingList` this week — that controller's own
/// doc), which the server refuses with a `ConflictError` once a list
/// already exists for this `menuId`. This screen renders that honestly (the
/// same error+retry state as any other load failure) rather than hiding it,
/// but "retry" cannot actually recover the real list here: this
/// controller's own `regenerateShoppingList` starts with `await future`
/// (its own doc) — the SAME already-failed `build()` — so it re-throws the
/// identical `ConflictError` rather than ever reaching the repository. A
/// real fix needs either a `Query.shoppingList` or the full user-facing
/// "Regenerate" affordance the plan names as a SEPARATE, not-yet-built
/// piece of this feature (`docs/E2E_MVP_PLAN.md` §17.3 S6); flagged here
/// rather than papered over with a silent, ultimately-broken auto-recovery
/// attempt (`flutter-reviewer` finding, W11 S6 review — this doc comment
/// records why that attempt was reverted).
class ShoppingListScreen extends ConsumerWidget {
  const ShoppingListScreen({super.key, required this.menuId});

  final String menuId;

  static const Key loadingKey = Key('shopping-list-loading');
  static const Key errorKey = Key('shopping-list-error');
  static const Key emptyKey = Key('shopping-list-empty');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ShoppingList> list = ref.watch(
      currentShoppingListControllerProvider(menuId),
    );

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Shopping list',
              onBack: () => context.go(AppRoutes.weeklyPlan),
              backSemanticLabel: 'Back to weekly plan',
            ),
            Expanded(
              child: switch ((list.valueOrNull, list.hasError)) {
                (final ShoppingList value, _) => _Loaded(list: value),
                (null, true) => Center(
                  key: ShoppingListScreen.errorKey,
                  child: PEmptyState(
                    headline: 'Could not load the shopping list',
                    body: list.error is AppError
                        ? (list.error! as AppError).errorMessage
                        : 'Something went wrong. Please try again.',
                    action: PButton(
                      label: 'Try again',
                      variant: PButtonVariant.secondary,
                      onPressed: () => ref.invalidate(
                        currentShoppingListControllerProvider(menuId),
                      ),
                    ),
                  ),
                ),
                _ => const Center(
                  key: ShoppingListScreen.loadingKey,
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
  const _Loaded({required this.list});

  final ShoppingList list;

  @override
  Widget build(BuildContext context) {
    final List<ShoppingListItem> toBuy = list.toBuy;
    if (toBuy.isEmpty) {
      // A plain message, deliberately NOT a `PEmptyState` — that component's
      // own doc requires a real `action` ("no dead ends"), and "everything
      // on this list is already checked off" genuinely has no further step
      // from here. Inventing an action just to satisfy the component would
      // be the "wall" that doc explicitly warns against, from the other
      // direction.
      return Center(
        key: ShoppingListScreen.emptyKey,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: Text(
            'Nothing left to buy — every item has been checked off.',
            textAlign: TextAlign.center,
            style: AppTypography.body.copyWith(color: AppColors.inkSoft),
          ),
        ),
      );
    }
    return CategorizedChecklist(items: toBuy);
  }
}
