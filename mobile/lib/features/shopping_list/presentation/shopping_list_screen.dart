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
import 'shopping_list_regenerate_confirm_dialog.dart';

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
/// **Regenerate (W11 S6b).** The trailing `PTopBar` action on the loaded
/// state calls [CurrentShoppingListController.regenerateShoppingList]
/// (D8's merge-regenerate design, §17.2.8/§17.7) — free (no confirm) when
/// the visible list has nothing left to buy, gated by
/// [showShoppingListRegenerateConfirmDialog] otherwise, same shape
/// `AutoFillPreviewScreen`'s Accept action uses for
/// `showRegenerateConfirmDialog` (W10 S6's own precedent for this
/// interaction). A failed regenerate never blanks the visible list — the
/// controller's own doc guarantees `state` is untouched on failure — it
/// only surfaces a transient error via [ScaffoldMessenger].
///
/// **The `ConflictError` gap this screen used to only document, now
/// partially closed.** `CurrentShoppingListController.build` always calls
/// `generateShoppingList` (there is no `Query.shoppingList` this week —
/// that controller's own doc), which the server refuses with a
/// `ConflictError` once a list already exists for this `menuId`. Before
/// W11 S6b, this screen's error state offered a "Try again" that only
/// re-threw the identical error forever (that controller's own doc names
/// the trap: `regenerateShoppingList` starts with `await future`, the SAME
/// already-failed `build()`). The error state now offers "Regenerate list"
/// instead specifically for a `ConflictError`, which calls
/// [CurrentShoppingListController.recoverFromConflict] — a method built
/// exactly to route around that stuck `future` — previewing first
/// (`confirmed: false`) to learn whether anything would be lost, then
/// gating the same confirm dialog before committing. Still not a full
/// fetch-and-display recovery (there is genuinely no way to VIEW the
/// existing list without either recomputing it via regenerate or a real
/// `Query.shoppingList`, which does not exist this week), but it is no
/// longer a dead end.
class ShoppingListScreen extends ConsumerStatefulWidget {
  const ShoppingListScreen({super.key, required this.menuId});

  final String menuId;

  static const Key loadingKey = Key('shopping-list-loading');
  static const Key errorKey = Key('shopping-list-error');
  static const Key emptyKey = Key('shopping-list-empty');
  static const Key regenerateButtonKey = Key('shopping-list-regenerate');
  static const Key conflictRegenerateButtonKey = Key(
    'shopping-list-conflict-regenerate',
  );

  @override
  ConsumerState<ShoppingListScreen> createState() => _ShoppingListScreenState();
}

class _ShoppingListScreenState extends ConsumerState<ShoppingListScreen> {
  /// Guards both regenerate entry points (the loaded-state trailing action
  /// and the `ConflictError` recovery action) against a double tap firing a
  /// second, overlapping attempt while the first hasn't resolved yet — set
  /// `true` for the ENTIRE attempt, tap to resolution, including the
  /// confirm-dialog wait in between (not just the network calls either side
  /// of it): a re-entrant tap during that wait would otherwise stack a
  /// second confirm dialog on top of the first, or — worse, in the
  /// conflict-recovery path — kick off a second, concurrent
  /// preview-then-commit sequence that could race the first one's `state`
  /// write (`flutter-reviewer` finding, W11 S6b review). Disables the
  /// triggering button via `onPressed: _isBusy ? null : ...` but is
  /// deliberately NOT what drives the button's spinner — see
  /// [_isRegenerating] for why those two are kept separate.
  bool _isBusy = false;

  /// Drives the triggering button's `isLoading` spinner — `true` ONLY while
  /// a network call (`regenerateShoppingList`/`recoverFromConflict`) is
  /// actually in flight, unlike [_isBusy] above which stays `true` across
  /// the confirm-dialog wait too. An indeterminate spinner animates forever
  /// while shown, so leaving it on through an unbounded, user-paced dialog
  /// wait would mean `pumpAndSettle` in a widget test never settles, and a
  /// real user would see a control that looks perpetually "working" while
  /// actually just waiting on them. [_isBusy] alone (no spinner) is enough
  /// to keep the button inert during that wait.
  bool _isRegenerating = false;

  /// The one write this screen can make from its loaded state: preview is
  /// never separately fetched here — the currently-visible [ShoppingList]'s
  /// own `toBuy` count IS the "would this lose anything" answer, same as
  /// `AutoFillPreviewScreen._onAcceptPressed` reading the ALREADY-loaded
  /// `Menu`'s unmade-item count rather than issuing an extra preview call
  /// just to decide whether to show a dialog.
  Future<void> _onRegeneratePressed(ShoppingList current) async {
    if (_isBusy) return;
    setState(() => _isBusy = true);

    final int notYetBoughtCount = current.toBuy.length;
    if (notYetBoughtCount > 0) {
      final bool confirmed = await showShoppingListRegenerateConfirmDialog(
        context: context,
        notYetBoughtCount: notYetBoughtCount,
      );
      // The dialog's own `await` is an unbounded, user-paced gap — this
      // widget could have been unmounted while it was showing.
      if (!mounted) return;
      if (!confirmed) {
        setState(() => _isBusy = false);
        return;
      }
    }

    await _finishRegenerate(
      () => ref
          .read(currentShoppingListControllerProvider(widget.menuId).notifier)
          .regenerateShoppingList(confirmed: true),
    );
  }

  /// The `ConflictError`-recovery entry point — see this file's own class
  /// doc for exactly why this cannot reuse [_onRegeneratePressed]'s
  /// already-loaded-list shortcut: there is no loaded list to read a
  /// `toBuy` count from here, so the confirm decision needs a real preview
  /// call first (`confirmed: false`, which writes nothing per
  /// `recoverFromConflict`'s own doc).
  Future<void> _onConflictRegeneratePressed() async {
    if (_isBusy) return;
    setState(() {
      _isBusy = true;
      _isRegenerating = true;
    });
    final ShoppingList? preview = await _guarded(
      () => ref
          .read(currentShoppingListControllerProvider(widget.menuId).notifier)
          .recoverFromConflict(confirmed: false),
    );
    if (!mounted) return;
    if (preview == null) {
      // The preview call itself failed — already surfaced via the
      // SnackBar inside `_guarded`. Nothing further to do; the error
      // state (unchanged) stays on screen for another retry.
      setState(() {
        _isBusy = false;
        _isRegenerating = false;
      });
      return;
    }
    // The preview call itself has finished — stop the SPINNER (but stay
    // `_isBusy`, so the button remains inert) through the confirm-dialog
    // wait below. See [_isRegenerating]'s own doc for why the spinner
    // specifically cannot stay on through that wait.
    setState(() => _isRegenerating = false);

    final int notYetBoughtCount = preview.toBuy.length;
    if (notYetBoughtCount > 0) {
      final bool confirmed = await showShoppingListRegenerateConfirmDialog(
        context: context,
        notYetBoughtCount: notYetBoughtCount,
      );
      if (!mounted) return;
      if (!confirmed) {
        setState(() => _isBusy = false);
        return;
      }
    }

    await _finishRegenerate(
      () => ref
          .read(currentShoppingListControllerProvider(widget.menuId).notifier)
          .recoverFromConflict(confirmed: true),
    );
  }

  Future<void> _finishRegenerate(Future<ShoppingList> Function() action) async {
    setState(() => _isRegenerating = true);
    await _guarded(action);
    if (!mounted) return;
    setState(() {
      _isBusy = false;
      _isRegenerating = false;
    });
  }

  /// Runs [action], returning its result on success. On failure, shows a
  /// transient [SnackBar] — never a state change — and returns `null`.
  /// Errors are never swallowed silently (this codebase's own error-handling
  /// rule): the previously-visible list stays exactly as it was, per
  /// `regenerateShoppingList`/`recoverFromConflict`'s own "state left
  /// unchanged on failure" contract, and the user is told the attempt
  /// failed rather than left guessing why nothing changed.
  Future<ShoppingList?> _guarded(Future<ShoppingList> Function() action) async {
    try {
      return await action();
    } catch (error) {
      if (!mounted) return null;
      final String message = error is AppError
          ? error.errorMessage
          : 'Could not regenerate the shopping list. Please try again.';
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<ShoppingList> list = ref.watch(
      currentShoppingListControllerProvider(widget.menuId),
    );
    final ShoppingList? loaded = list.valueOrNull;

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
              trailing: loaded == null
                  ? null
                  : PIconButton(
                      key: ShoppingListScreen.regenerateButtonKey,
                      icon: Icons.refresh,
                      semanticLabel: 'Regenerate shopping list',
                      isLoading: _isRegenerating,
                      onPressed: _isBusy
                          ? null
                          : () => _onRegeneratePressed(loaded),
                    ),
            ),
            Expanded(
              child: switch ((loaded, list.hasError)) {
                (final ShoppingList value, _) => _Loaded(list: value),
                (null, true) when list.error is ConflictError => Center(
                  key: ShoppingListScreen.errorKey,
                  child: PEmptyState(
                    headline: 'This week already has a shopping list',
                    body:
                        'Regenerate to recompute it from the current menu '
                        'and pantry — anything you\'ve already checked off '
                        'stays kept.',
                    action: PButton(
                      key: ShoppingListScreen.conflictRegenerateButtonKey,
                      label: 'Regenerate list',
                      variant: PButtonVariant.secondary,
                      isLoading: _isRegenerating,
                      onPressed: _isBusy ? null : _onConflictRegeneratePressed,
                    ),
                  ),
                ),
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
                        currentShoppingListControllerProvider(widget.menuId),
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
      // direction. (The Regenerate affordance for this state lives on the
      // `PTopBar` trailing action, not here.)
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
