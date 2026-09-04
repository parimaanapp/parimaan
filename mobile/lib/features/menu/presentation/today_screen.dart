import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/current_week.dart';
import '../domain/menu.dart';
import '../domain/today.dart';
import '../state/current_menu_controller.dart';
import '../state/pending_mark_made_action.dart';

/// The Home tab's real content (E2E_MVP_PLAN.md §15.1/§15.3 S6) — wireframe
/// screens "Today morning" (today has ≥1 planned item) and "Today empty"
/// (zero), the same screen branching on whether [todaysItems] is empty
/// rather than two separate widgets, since the only difference between
/// them is that one branch.
///
/// Replaces the former `HomeScreen`'s own placeholder body — that file's doc
/// explicitly deferred to "the real Home screen slice," and a daily agenda
/// is exactly what a meal-planning app's Home landing is for. The one thing
/// carried over from it is reaching Settings, now a gear icon in the top
/// bar rather than a standalone button — the same discoverable-but-
/// unobtrusive placement `PantryListScreen`'s own trailing icon button
/// uses for its own "+".
///
/// Reuses `CurrentMenuController` — no second fetch. `todaysItems` is a
/// pure function over the SAME `Menu` `WeeklyPlanScreen` already fetches
/// for the current week (§15.2.5's own "reuse `Query.menu`" decision).
class TodayScreen extends ConsumerWidget {
  const TodayScreen({super.key});

  static const Key loadingKey = Key('today-loading');
  static const Key errorKey = Key('today-error');
  static const Key emptyStateKey = Key('today-empty');
  static const Key settingsButtonKey = Key('today-settings');

  /// The per-item "Mark as made" affordance — present iff [menuItemId]'s
  /// item is neither server-confirmed made nor currently optimistically
  /// made (W12 S5, E2E_MVP_PLAN.md §18.2.8/§18.3).
  static Key markMadeButtonKey(String menuItemId) =>
      _TodayItemCard.markMadeButtonKey(menuItemId);

  /// The muted checkmark shown in place of [markMadeButtonKey] once
  /// [menuItemId]'s item is made — server-confirmed or this tap's own
  /// optimistic state (see [_TodayItemCardState] for why the two aren't
  /// distinguished in the UI).
  static Key madeBadgeKey(String menuItemId) =>
      _TodayItemCard.madeBadgeKey(menuItemId);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: household == null
            ? const Center(key: loadingKey, child: CircularProgressIndicator())
            : _TodayForHousehold(household: household),
      ),
    );
  }
}

class _TodayForHousehold extends ConsumerWidget {
  const _TodayForHousehold({required this.household});

  final Household household;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final MenuKey key = menuKeyFor(household.id, currentWeekStartDate());
    final AsyncValue<Menu> menu = ref.watch(currentMenuControllerProvider(key));
    // `read`, not `watch` — consistent with every other controller access
    // in this codebase (`CurrentMenuController`'s own doc). `_TodayItemCard`
    // calls this once its own deferred window elapses (D8, §18.2.8) — it
    // never calls the controller directly, so it stays provider-free and
    // independently testable, same "callback, not a provider read" boundary
    // `have_it_quantity_sheet.dart`'s `onConfirm` already uses.
    final Future<void> Function(String menuItemId) onMarkMade = ref
        .read(currentMenuControllerProvider(key).notifier)
        .markMade;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PTopBar(
          title: 'Today',
          trailing: PButton.icon(
            key: TodayScreen.settingsButtonKey,
            icon: Icons.settings_outlined,
            semanticLabel: 'Household settings',
            variant: PButtonVariant.ghost,
            onPressed: () => context.go(AppRoutes.settingsHub(household.id)),
          ),
        ),
        Expanded(
          child: switch (menu.valueOrNull) {
            final Menu menuValue => _TodayBody(
              menu: menuValue,
              onMarkMade: onMarkMade,
            ),
            null when menu.hasError => Center(
              key: TodayScreen.errorKey,
              child: _LoadFailed(
                error: menu.error,
                onRetry: () =>
                    ref.invalidate(currentMenuControllerProvider(key)),
              ),
            ),
            null => const Center(
              key: TodayScreen.loadingKey,
              child: CircularProgressIndicator(),
            ),
          },
        ),
      ],
    );
  }
}

/// Same shape as `WeeklyPlanScreen`'s own `_LoadFailed` — a real
/// `PEmptyState`, an `AppError`-narrowed message, and a "Try again" retry.
/// **Not** the same widget as `WeeklyPlanScreen._LoadFailed` (private to
/// that file) — duplicated rather than shared for a two-instance pattern,
/// same threshold `HouseholdFields`/`MenuFields` etc. use before a fragment
/// or shared widget earns its place.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.error, required this.onRetry});

  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final Object? currentError = error;
    return PEmptyState(
      headline: 'Could not load today\'s plan',
      body: currentError is AppError ? currentError.errorMessage : '',
      action: PButton(
        label: 'Try again',
        variant: PButtonVariant.secondary,
        onPressed: onRetry,
      ),
    );
  }
}

class _TodayBody extends StatelessWidget {
  const _TodayBody({required this.menu, required this.onMarkMade});

  final Menu menu;

  /// Threaded straight through to every [_TodayItemCard] — the RAW,
  /// immediate `CurrentMenuController.markMade` (S4). `_TodayItemCard`
  /// never calls this synchronously on tap — it schedules it behind a
  /// [PendingMarkMadeAction] (D8, §18.2.8) and only actually invokes it
  /// once that action's undo window elapses uninterrupted.
  final Future<void> Function(String menuItemId) onMarkMade;

  static Key itemKey(String menuItemId) => Key('today-item-$menuItemId');

  @override
  Widget build(BuildContext context) {
    final List<MenuItem> items = todaysItems(menu);

    if (items.isEmpty) {
      // "Today empty" — a real destination, not a dead end: PRD's own
      // no-dead-ends rule, same as `RecipePickerStubScreen`/
      // `SettingsPlaceholderScreen`.
      return Center(
        child: PEmptyState(
          key: TodayScreen.emptyStateKey,
          headline: 'Nothing planned for today',
          body: 'Add recipes to today\'s slots from the Weekly plan.',
          action: PButton(
            label: 'Go to Weekly plan',
            variant: PButtonVariant.secondary,
            // `context.go`, not `context.push` — `weeklyPlan` is a sibling
            // shell-tab branch (S6's own tab wiring), and `go` is what
            // switches to it cleanly instead of pushing a second, nested
            // copy of the shell on top of this one.
            onPressed: () => context.go(AppRoutes.weeklyPlan),
          ),
        ),
      );
    }

    // "Today morning" — the day's own agenda, breakfast → lunch → snacks →
    // dinner (`todaysItems`' own sort), each rendered read-only (no "+" for
    // an empty slot here — that's the Weekly plan grid's own job; Today is
    // a summary of what IS planned, not a second place to plan it).
    return ListView.builder(
      padding: const EdgeInsets.all(AppSpacing.s3),
      itemCount: items.length,
      itemBuilder: (BuildContext context, int i) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.s2),
        child: _TodayItemCard(
          // A stable, id-based key — not positional — is required here:
          // `_TodayItemCard` owns live per-item state (a `Timer`-backed
          // `PendingMarkMadeAction`, `_optimisticMade`), and this list is
          // re-sorted from a fresh server `Menu` on every `refresh()`
          // (including the very refresh THIS feature triggers on a
          // successful deferred commit). Without a stable key, Flutter
          // would reconcile children positionally and could hand an
          // existing `_TodayItemCardState` — pending timer and all — to a
          // DIFFERENT `MenuItem` after a reorder, firing `markMade` for
          // the wrong id (flutter-reviewer finding, W12 S5).
          key: _TodayBody.itemKey(items[i].id),
          item: items[i],
          onMarkMade: onMarkMade,
        ),
      ),
    );
  }
}

/// One item on today's agenda — the recipe/slot summary [_TodayBody] always
/// rendered, plus the "Mark as made" affordance (Flow 6, wireframe 40/49,
/// E2E_MVP_PLAN.md §18.2.8/§18.3 S5).
///
/// **O5/D8's locked single-tap + undo design**, not a confirm dialog: a tap
/// on [markMadeButtonKey] shows this item's made state immediately AND a
/// "Marked as made · Undo" snackbar (via [PToast.show]), and starts a
/// [PendingMarkMadeAction] — [onMarkMade] (the RAW, immediate
/// `CurrentMenuController.markMade`) is **not** called at that point. Only
/// once the snackbar's own window elapses without an Undo tap does the
/// pending action actually invoke [onMarkMade]. Tapping Undo within the
/// window cancels the pending action with zero network calls — see
/// [PendingMarkMadeAction]'s own class doc for why no compensating mutation
/// is needed.
///
/// An item whose [MenuItem.madeAt] is already set (a prior real commit —
/// either from this session's own elapsed window or from before this
/// screen loaded) renders [madeBadgeKey]'s muted checkmark instead of the
/// button — a second tap would only hit `markMade`'s own `CONFLICT`
/// rejection uselessly (S2, E2E_MVP_PLAN.md §18.3).
class _TodayItemCard extends StatefulWidget {
  const _TodayItemCard({
    super.key,
    required this.item,
    required this.onMarkMade,
  });

  final MenuItem item;
  final Future<void> Function(String menuItemId) onMarkMade;

  static Key markMadeButtonKey(String menuItemId) =>
      Key('today-mark-made-$menuItemId');
  static Key madeBadgeKey(String menuItemId) => Key('today-made-$menuItemId');

  @override
  State<_TodayItemCard> createState() => _TodayItemCardState();
}

class _TodayItemCardState extends State<_TodayItemCard> {
  /// Non-null for the whole undo window, and while the deferred `markMade`
  /// call it eventually fires is in flight — see [PendingMarkMadeAction]'s
  /// own class doc. Cleared on every outcome (undo, success, failure), so
  /// `_pending != null` always means "an action is genuinely live for this
  /// item right now."
  PendingMarkMadeAction? _pending;

  /// The optimistic "made" flag D8's design sets the instant the tap
  /// happens — independent of [MenuItem.madeAt] until the real mutation
  /// commits and this screen's own `CurrentMenuController.refresh` (inside
  /// [MenuRepository.markMade]'s caller) rebuilds this widget from a fresh
  /// `Menu`, at which point the two agree.
  bool _optimisticMade = false;

  bool get _isMade => widget.item.madeAt != null || _optimisticMade;

  @override
  void dispose() {
    // Cancels a still-pending action if this card leaves the tree mid-
    // window (e.g. navigating away from Today) — ordinary StatefulWidget
    // hygiene, not a change to D8's own contract: the deferred call was
    // never guaranteed to survive the owning widget disappearing, only a
    // normal foreground app lifecycle while it stays mounted (§18.2.8's
    // own explicit scope).
    _pending?.cancel();
    super.dispose();
  }

  void _startMarkMade() {
    // Already made (server-confirmed or this tap's own optimistic state),
    // or a pending action is already in flight for this item: a no-op.
    // See `PendingMarkMadeAction`'s own class doc for why a second tap
    // while pending is a no-op rather than restarting the window.
    if (_isMade || _pending != null) return;

    setState(() => _optimisticMade = true);

    final PendingMarkMadeAction action = PendingMarkMadeAction(
      menuItemId: widget.item.id,
      onCommit: widget.onMarkMade,
      onSuccess: _handleCommitSucceeded,
      onError: _handleCommitFailed,
    );
    _pending = action;

    // `PendingMarkMadeAction`'s own timer starts now, at tap time — but
    // `ScaffoldMessenger` shows only one `SnackBar` at a time and QUEUES
    // the rest, only starting a queued bar's own visible-duration timer
    // once it actually becomes visible. Marking a second item made while
    // an earlier item's toast is still showing would otherwise leave this
    // item's own toast silently queued — its visible "Undo" window could
    // shrink to nothing before the user ever sees it, defeating D8's own
    // "window matched to the visible snackbar duration" guarantee.
    // Clearing first guarantees THIS toast is shown immediately, at the
    // cost of cutting short whatever toast (if any) was already showing
    // for a sibling item — that sibling's own `PendingMarkMadeAction`
    // timer is completely unaffected by its toast disappearing early, only
    // its own visible Undo affordance is; a deliberate, narrower trade
    // than silently starving the NEW tap's window instead. Using
    // `ScaffoldMessenger`'s own queue operations throughout (here, in
    // [_undo], in [_handleCommitFailed]) rather than holding onto this
    // call's own returned `ScaffoldFeatureController` and calling `.close`
    // on it directly — a stored controller can already have been evicted
    // by a LATER item's own `clearSnackBars()` call by the time this
    // item's outcome (undo, or a failed deferred commit) is reached, and
    // `ScaffoldMessengerState` asserts the controller it's asked to close
    // is still the current one, throwing otherwise.
    ScaffoldMessenger.of(context).clearSnackBars();
    PToast.show(
      context: context,
      toast: PToast(
        message: 'Marked as made',
        tone: PToastTone.success,
        icon: Icons.check_circle_outline,
        actionLabel: 'Undo',
        onAction: _undo,
      ),
      // Matches the pending action's own window — D8's own design.
      duration: PendingMarkMadeAction.defaultPendingWindow,
    );
  }

  void _undo() {
    final PendingMarkMadeAction? action = _pending;
    if (action == null) return;
    action.cancel();
    _pending = null;
    // Undo is only reachable by tapping the control INSIDE this item's own
    // currently-visible toast, so it's always safe to remove "whatever is
    // showing right now" here — it can only be this one.
    if (mounted) {
      ScaffoldMessenger.of(context).removeCurrentSnackBar();
      setState(() => _optimisticMade = false);
    }
  }

  /// The deferred `markMade` call actually fired (the window elapsed) and
  /// succeeded — nothing left to track; the item's own `madeAt` lands via
  /// `CurrentMenuController.refresh` (inside [MenuRepository.markMade]'s
  /// caller) rebuilding this widget from a fresh `Menu`, at which point
  /// `widget.item.madeAt` and `_optimisticMade` agree. Clearing [_pending]
  /// here (rather than leaving a stale, functionally-inert reference)
  /// keeps "an action is pending" and "`_pending != null`" the same
  /// statement at every point in this state's lifetime.
  void _handleCommitSucceeded() {
    _pending = null;
  }

  /// The deferred `markMade` call actually fired (the window elapsed) and
  /// the server rejected it — reverts the optimistic state and surfaces a
  /// visible error, this codebase's standing "never a silent no-op" rule
  /// (`have_it_quantity_sheet.dart`, `checklist_item.dart`).
  ///
  /// **Note on what "rejected" covers:** `CurrentMenuController.markMade`
  /// (S4) throws both when the mutation itself is rejected server-side
  /// (e.g. `ConflictError`, nothing changed) AND when the mutation
  /// succeeds but the follow-up `refresh()` fails (the item IS made
  /// server-side; only this client's own view is stale — see that
  /// method's own doc). Both land here and are shown identically. This
  /// mirrors `addMenuItem`/`removeMenuItem`'s own identical, already-
  /// established "throws either way, caller can't tell which" contract
  /// (`current_menu_controller.dart`) — not a gap introduced by this
  /// slice, and not one this slice's own scope owns fixing.
  void _handleCommitFailed(Object error) {
    _pending = null;
    if (!mounted) return;
    setState(() => _optimisticMade = false);
    final String message = error is AppError
        ? error.errorMessage
        : 'Could not mark as made.';
    // Same "don't silently queue behind whatever else is showing" — and
    // same "use the queue API, never a stored controller" — reasoning as
    // [_startMarkMade]'s own `clearSnackBars()` call. An error is exactly
    // the case that must never go unseen.
    ScaffoldMessenger.of(context).clearSnackBars();
    PToast.show(
      context: context,
      toast: PToast(message: message, tone: PToastTone.danger),
      duration: const Duration(seconds: 4),
    );
  }

  @override
  Widget build(BuildContext context) {
    final MenuItem item = widget.item;

    // No key here — `_TodayItemCard` itself already carries the stable,
    // id-based key that matters for `ListView.builder` reconciliation
    // (see its construction site in `_TodayBody.build`); `PCard` is this
    // widget's sole child, with no siblings a key would disambiguate among.
    return PCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  item.slotRole.displayLabel,
                  style: AppTypography.meta.copyWith(color: AppColors.inkMid),
                ),
                const SizedBox(height: AppSpacing.s1),
                Text(item.recipe.title, style: AppTypography.bodyStrong),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          if (_isMade)
            Icon(
              Icons.check_circle,
              key: _TodayItemCard.madeBadgeKey(item.id),
              color: AppColors.success,
              semanticLabel: 'Made',
            )
          else
            PButton(
              key: _TodayItemCard.markMadeButtonKey(item.id),
              label: 'Mark as made',
              variant: PButtonVariant.affirmative,
              size: PButtonSize.small,
              onPressed: _startMarkMade,
            ),
        ],
      ),
    );
  }
}
