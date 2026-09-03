import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/meal_slot_plan.dart';
import '../domain/menu.dart';
import '../state/current_menu_controller.dart';
import 'regenerate_confirm_dialog.dart';
import 'weekly_plan_screen.dart' show weekdayNames;

/// Wireframes 6.3/6.7, "Auto-fill preview" (E2E_MVP_PLAN.md §16.3 S6) — the
/// *unsaved* `autoFillPreview` proposal `WeeklyPlanScreen`'s own "Auto-fill
/// week" action pushes to. Two independent write-adjacent decisions live on
/// this screen and nowhere else:
///
///  * **Regenerate is free.** It only re-runs `previewAutoFill()` — a pure
///    read (D3) — so it never confirms and never touches `menu_items`.
///  * **Accept is the one path that writes.** It calls `commitAutoFill`
///    (`autoFillWeek(overwrite: true, ...)`), gated by
///    [showRegenerateConfirmDialog] whenever the current menu already has an
///    unmade item that commit would replace (§16.2.7, D4) — skipped when it
///    doesn't, since there is nothing to lose.
///
/// The proposal itself lives in local [State], not in
/// `CurrentMenuController`'s own `state` — it is deliberately NOT the
/// household's menu (nothing has been written), so folding it into that
/// controller's `AsyncValue<Menu>` would either invent a fake `Menu` or
/// silently mean something committed. [CurrentMenuController.previewAutoFill]
/// already returns the same value this screen renders; keeping it here is
/// just "don't let a dry run masquerade as a saved state."
class AutoFillPreviewScreen extends ConsumerStatefulWidget {
  const AutoFillPreviewScreen({super.key, required this.menuKey});

  /// Same family key `WeeklyPlanScreen` reads `CurrentMenuController`
  /// through — see `AppRoutes.autoFillPreview`'s own doc for why this
  /// travels as `extra`, not a URL fragment this screen re-derives.
  final MenuKey menuKey;

  static const Key loadingKey = Key('auto-fill-preview-loading');
  static const Key errorKey = Key('auto-fill-preview-error');
  static const Key summaryKey = Key('auto-fill-preview-summary');
  static const Key regenerateButtonKey = Key('auto-fill-preview-regenerate');
  static const Key acceptButtonKey = Key('auto-fill-preview-accept');
  static const Key commitErrorKey = Key('auto-fill-preview-commit-error');
  static const Key committedSummaryKey = Key(
    'auto-fill-preview-committed-summary',
  );
  static const Key doneButtonKey = Key('auto-fill-preview-done');

  /// Key prefixes a test can match on with `Key.toString()` — see each
  /// factory below for the full shape. Exposed as `static const String`s
  /// (not just the factories) so a test asserting "there are exactly N
  /// proposed rows" doesn't need to already know every `(day, mealSlot,
  /// slotRole, index)` combination up front — the cross-language-canary
  /// test (§16.5.1) is exactly this shape.
  static const String proposedKeyPrefix = 'auto-fill-proposed-';
  static const String filledKeyPrefix = 'auto-fill-filled-';
  static const String unfilledKeyPrefix = 'auto-fill-unfilled-';

  static Key proposedKey(
    int dayOfWeek,
    String mealSlot,
    String slotRole,
    int index,
  ) => Key('$proposedKeyPrefix$dayOfWeek-$mealSlot-$slotRole-$index');

  static Key filledKey(String menuItemId) => Key('$filledKeyPrefix$menuItemId');

  static Key unfilledKey(
    int dayOfWeek,
    String mealSlot,
    String slotRole,
    int index,
  ) => Key('$unfilledKeyPrefix$dayOfWeek-$mealSlot-$slotRole-$index');

  @override
  ConsumerState<AutoFillPreviewScreen> createState() =>
      _AutoFillPreviewScreenState();
}

class _AutoFillPreviewScreenState
    extends ConsumerState<AutoFillPreviewScreen> {
  AsyncValue<AutoFillPreviewResult> _preview =
      const AsyncValue<AutoFillPreviewResult>.loading();

  /// The one write this screen can make, as a single `AsyncValue` rather
  /// than three independent booleans (`committed`/`error`/`isCommitting`) —
  /// `null` means "never attempted," and otherwise this is exactly
  /// `AsyncValue.guard`'s own loading/data/error discriminant, same as
  /// [_preview] two fields up. Deliberately makes "committed AND errored at
  /// once" unrepresentable, which three separate fields did not.
  AsyncValue<AutoFillResult>? _commitState;

  @override
  void initState() {
    super.initState();
    _regenerate();
  }

  /// The ONLY thing this method ever calls is `previewAutoFill()` — never
  /// `commitAutoFill`. See this screen's own class doc and
  /// `auto_fill_preview_screen_test.dart`'s direct assertion against the
  /// fake repository for the RED spec this exists to satisfy.
  ///
  /// `copyWithPrevious` keeps the LAST proposal on screen while a
  /// regenerate is in flight — same "never blank on a refetch" convention
  /// `CurrentMenuController.refresh` and every other controller in this
  /// codebase already use — rather than tearing the whole list down to a
  /// bare spinner on every free "Regenerate" tap.
  Future<void> _regenerate() async {
    final AsyncValue<AutoFillPreviewResult> previous = _preview;
    setState(() {
      _preview = const AsyncValue<AutoFillPreviewResult>.loading()
          .copyWithPrevious(previous);
      // A stale commit error/result from a previous Accept attempt
      // shouldn't linger over a freshly regenerated proposal.
      _commitState = null;
    });

    final AsyncValue<AutoFillPreviewResult> result =
        await AsyncValue.guard<AutoFillPreviewResult>(
          () => ref
              .read(currentMenuControllerProvider(widget.menuKey).notifier)
              .previewAutoFill(),
        );
    if (!mounted) return;
    setState(() => _preview = result);
  }

  /// Gates the one write path this screen has: [showRegenerateConfirmDialog]
  /// is shown, and must resolve `true`, whenever the menu already has an
  /// unmade item — otherwise [_commit] runs straight away. This method (not
  /// a button `onPressed` inline) is the single call site, so there is
  /// exactly one place in this file that can reach [_commit] at all.
  Future<void> _onAcceptPressed() async {
    final AutoFillPreviewResult? preview = _preview.valueOrNull;
    if (preview == null || (_commitState?.isLoading ?? false)) return;

    final Menu? menu = ref
        .read(currentMenuControllerProvider(widget.menuKey))
        .valueOrNull;
    final int unmadeItemCount =
        menu?.items.where((MenuItem item) => item.madeAt == null).length ?? 0;

    if (unmadeItemCount > 0) {
      final bool confirmed = await showRegenerateConfirmDialog(
        context: context,
        unmadeItemCount: unmadeItemCount,
      );
      // The dialog's own `await` is an unbounded, user-paced gap — the
      // screen could have been popped while it was showing, so `mounted`
      // is checked before touching `State` at all, not just inside
      // `_commit`.
      if (!mounted || !confirmed) return;
    }

    await _commit(preview);
  }

  Future<void> _commit(AutoFillPreviewResult preview) async {
    setState(
      () => _commitState = const AsyncValue<AutoFillResult>.loading(),
    );

    final AsyncValue<AutoFillResult> result =
        await AsyncValue.guard<AutoFillResult>(
          () => ref
              .read(currentMenuControllerProvider(widget.menuKey).notifier)
              .commitAutoFill(
                overwrite: true,
                items: preview.items
                    .map((ProposedMenuItem item) => item.toDraft())
                    .toList(growable: false),
              ),
        );
    if (!mounted) return;
    // A failed commit leaves `_preview` (and `CurrentMenuController`'s own
    // `state`, which `commitAutoFill` never assigns on a throw — see that
    // method's own doc) exactly as they were: the proposal stays on
    // screen, and the user can retry Accept or Regenerate. Never blanked.
    setState(() => _commitState = result);
  }

  @override
  Widget build(BuildContext context) {
    final AutoFillResult? committed = _commitState?.valueOrNull;
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Auto-fill preview',
              onBack: () => context.pop(),
              backSemanticLabel: 'Back to weekly plan',
            ),
            Expanded(
              child: committed != null
                  ? _CommittedSummary(
                      result: committed,
                      onDone: () => context.pop(),
                    )
                  : _AutoFillPreviewBody(
                      menuKey: widget.menuKey,
                      preview: _preview,
                      commitState: _commitState,
                      onRegenerate: _regenerate,
                      onAccept: _onAcceptPressed,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `error is AppError ? error.errorMessage : ...` — same narrowing every
/// other load-failure state in this feature uses (`WeeklyPlanScreen`'s own
/// `_LoadFailed`), never a raw exception's `toString()`.
String _errorMessage(Object? error) => error is AppError
    ? error.errorMessage
    : 'Something went wrong. Please try again.';

/// Honest headline for BOTH the preview stage (`AutoFillPreviewResult`) and
/// the post-commit stage (`AutoFillResult`) — both share the same
/// `filledCount`/`unfilledSlots` shape (D5), and a commit can under-deliver
/// relative to its own preview (§16.2.1's re-validation-skip case), so the
/// two call sites deliberately never share a cached number: each passes its
/// own result's own fields.
String _fillSummaryHeadline(int filledCount, List<UnfilledSlot> unfilledSlots) {
  final int total = filledCount + unfilledSlots.length;
  if (total == 0) return 'Every meal slot already has a recipe.';
  if (unfilledSlots.isEmpty) {
    return 'Filled all $total empty slot${total == 1 ? '' : 's'}.';
  }
  return 'Filled $filledCount of $total empty slots.';
}

/// The specific, never-silently-indistinguishable-from-a-full-fill detail
/// line for a partial fill.
String _unfilledDetail(List<UnfilledSlot> unfilledSlots) {
  final int count = unfilledSlots.length;
  return '$count slot${count == 1 ? '' : 's'} could not be filled — not '
      'enough in-rotation recipes for ${count == 1 ? 'that meal' : 'those meals'} yet.';
}

/// Resolves the household/menu/preview reads and picks the loading, error,
/// or loaded state to render — the equivalent of `WeeklyPlanScreen`'s own
/// `_WeeklyPlanForHousehold`, extracted to a real widget class (rather than
/// a private method on the `State`) for the same reason that file's own
/// `_WeekBody`/`_LoadFailed`/`_DaySection` are: a `Widget` subtype gets
/// Flutter's own tree-diffing and rebuild-scoping, a method returning
/// `Widget` does not.
class _AutoFillPreviewBody extends ConsumerWidget {
  const _AutoFillPreviewBody({
    required this.menuKey,
    required this.preview,
    required this.commitState,
    required this.onRegenerate,
    required this.onAccept,
  });

  final MenuKey menuKey;
  final AsyncValue<AutoFillPreviewResult> preview;
  final AsyncValue<AutoFillResult>? commitState;
  final VoidCallback onRegenerate;
  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Menu> menu = ref.watch(
      currentMenuControllerProvider(menuKey),
    );
    final AsyncValue<Household> household = ref.watch(
      currentHouseholdControllerProvider(menuKey.householdId),
    );

    if (menu.hasError || household.hasError) {
      return Center(
        key: AutoFillPreviewScreen.errorKey,
        child: PEmptyState(
          headline: 'Could not load the weekly plan',
          body: _errorMessage(menu.error ?? household.error),
          action: PButton(
            label: 'Try again',
            variant: PButtonVariant.secondary,
            onPressed: () {
              ref.invalidate(currentMenuControllerProvider(menuKey));
              ref.invalidate(
                currentHouseholdControllerProvider(menuKey.householdId),
              );
            },
          ),
        ),
      );
    }

    if (preview.hasError) {
      return Center(
        key: AutoFillPreviewScreen.errorKey,
        child: PEmptyState(
          headline: 'Could not generate a proposal',
          body: _errorMessage(preview.error),
          action: PButton(
            label: 'Try again',
            variant: PButtonVariant.secondary,
            onPressed: onRegenerate,
          ),
        ),
      );
    }

    final Menu? menuValue = menu.valueOrNull;
    final Household? householdValue = household.valueOrNull;
    final AutoFillPreviewResult? previewValue = preview.valueOrNull;
    if (menuValue == null || householdValue == null || previewValue == null) {
      return const Center(
        key: AutoFillPreviewScreen.loadingKey,
        child: CircularProgressIndicator(),
      );
    }

    return _LoadedPreview(
      menu: menuValue,
      settings: householdValue.settings,
      preview: previewValue,
      isRegenerating: preview.isLoading,
      isCommitting: commitState?.isLoading ?? false,
      commitError: commitState != null && commitState!.hasError
          ? commitState!.error
          : null,
      onRegenerate: onRegenerate,
      onAccept: onAccept,
    );
  }
}

/// The loaded-preview layout: the honest fill summary, the day-by-day
/// [_PreviewList], and the Regenerate/Accept footer — extracted from
/// `_AutoFillPreviewScreenState` for the same "real widget class, not a
/// private method" reason `_AutoFillPreviewBody`'s own doc gives.
class _LoadedPreview extends StatelessWidget {
  const _LoadedPreview({
    required this.menu,
    required this.settings,
    required this.preview,
    required this.isRegenerating,
    required this.isCommitting,
    required this.commitError,
    required this.onRegenerate,
    required this.onAccept,
  });

  final Menu menu;
  final HouseholdSettings settings;
  final AutoFillPreviewResult preview;
  final bool isRegenerating;
  final bool isCommitting;
  final Object? commitError;
  final VoidCallback onRegenerate;
  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context) {
    final bool busy = isRegenerating || isCommitting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                _fillSummaryHeadline(preview.filledCount, preview.unfilledSlots),
                key: AutoFillPreviewScreen.summaryKey,
                style: AppTypography.bodyStrong,
              ),
              if (preview.unfilledSlots.isNotEmpty) ...<Widget>[
                const SizedBox(height: AppSpacing.s1),
                Text(
                  _unfilledDetail(preview.unfilledSlots),
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                ),
              ],
              if (commitError != null) ...<Widget>[
                const SizedBox(height: AppSpacing.s1),
                Text(
                  _errorMessage(commitError),
                  key: AutoFillPreviewScreen.commitErrorKey,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ],
            ],
          ),
        ),
        Expanded(
          child: _PreviewList(menu: menu, settings: settings, preview: preview),
        ),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.s3),
          child: Row(
            children: <Widget>[
              Expanded(
                child: PButton(
                  key: AutoFillPreviewScreen.regenerateButtonKey,
                  label: 'Regenerate',
                  variant: PButtonVariant.secondary,
                  isLoading: isRegenerating,
                  loadingLabel: 'Regenerating…',
                  onPressed: busy ? null : onRegenerate,
                ),
              ),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                child: PButton(
                  key: AutoFillPreviewScreen.acceptButtonKey,
                  label: 'Accept',
                  variant: PButtonVariant.affirmative,
                  isLoading: isCommitting,
                  loadingLabel: 'Saving…',
                  onPressed: busy ? null : onAccept,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The day-by-day listing: every [PlannedSlot] `plannedSlotsForDay` would
/// render on `WeeklyPlanScreen` itself, but read-only and three-way rather
/// than two — already filled (existing [MenuItem]), proposed (a
/// [ProposedMenuItem] this preview offers for that empty slot), or unfilled
/// (no proposal matched — either no in-rotation recipe exists for that role,
/// or every candidate for that slot was already exhausted this run).
///
/// Rendering exactly one row per [PlannedSlot] — never more, never fewer —
/// is the client-side half of §16.5.1's cross-language canary: this list's
/// own total row count across all 7 days must equal
/// `plannedSlotsForDay`'s own slot count for the week, the same function
/// `WeeklyPlanScreen`'s grid itself calls.
///
/// A plain `ListView` over EAGERLY built day sections, deliberately NOT
/// `ListView.builder`: the per-day row computation below consumes
/// `proposalsByTriple` DESTRUCTIVELY (`removeAt(0)`), and a lazy builder's
/// `itemBuilder` can be invoked more than once for the same index within a
/// single `build()` (an item that scrolls out of the cache extent and back
/// in is rebuilt from scratch) — a second invocation would find its queue
/// already drained by the first and silently render a previously-proposed
/// slot as unfilled. Building all 7 (small, bounded) day sections once,
/// up front, makes the destructive consumption safe by construction: it
/// only ever runs once per `build()`, and a rebuild recomputes the whole
/// list from `preview.items` again rather than mutating shared state
/// mid-scroll.
class _PreviewList extends StatelessWidget {
  const _PreviewList({
    required this.menu,
    required this.settings,
    required this.preview,
  });

  final Menu menu;
  final HouseholdSettings settings;
  final AutoFillPreviewResult preview;

  @override
  Widget build(BuildContext context) {
    // Proposals for the same `(day, mealSlot, slotRole)` triple (e.g. two
    // `sabziDal` slots on the same day) are matched to planned slots in
    // list order — a FIFO queue per triple, popped as each matching planned
    // slot is visited below. Never assumes `preview.items`' own order lines
    // up with `plannedSlotsForDay`'s emission order.
    final Map<String, List<ProposedMenuItem>> proposalsByTriple =
        <String, List<ProposedMenuItem>>{};
    for (final ProposedMenuItem item in preview.items) {
      proposalsByTriple
          .putIfAbsent(
            '${item.dayOfWeek}-${item.mealSlot}-${item.slotRole.name}',
            () => <ProposedMenuItem>[],
          )
          .add(item);
    }

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.s3),
      children: <Widget>[
        for (int dayOfWeek = 0; dayOfWeek < weekdayNames.length; dayOfWeek++)
          _daySection(dayOfWeek, proposalsByTriple),
      ],
    );
  }

  Widget _daySection(
    int dayOfWeek,
    Map<String, List<ProposedMenuItem>> proposalsByTriple,
  ) {
    final List<PlannedSlot> planned = plannedSlotsForDay(
      settings,
      menu.itemsForDay(dayOfWeek),
    );
    final Map<String, int> indexByTriple = <String, int>{};
    final List<Widget> rows = <Widget>[];

    for (final PlannedSlot slot in planned) {
      final String tripleKey =
          '$dayOfWeek-${slot.mealType.wireValue}-${slot.slotRole.name}';
      final int index = indexByTriple[tripleKey] ?? 0;
      indexByTriple[tripleKey] = index + 1;

      if (slot.isFilled) {
        rows.add(_FilledRow(item: slot.item!));
        continue;
      }

      final List<ProposedMenuItem>? queue = proposalsByTriple[tripleKey];
      if (queue != null && queue.isNotEmpty) {
        rows.add(
          _ProposedRow(
            key: AutoFillPreviewScreen.proposedKey(
              dayOfWeek,
              slot.mealType.wireValue,
              slot.slotRole.name,
              index,
            ),
            item: queue.removeAt(0),
          ),
        );
      } else {
        rows.add(
          _UnfilledRow(
            key: AutoFillPreviewScreen.unfilledKey(
              dayOfWeek,
              slot.mealType.wireValue,
              slot.slotRole.name,
              index,
            ),
            roleLabel: slot.slotRole.displayLabel,
          ),
        );
      }
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(weekdayNames[dayOfWeek], style: AppTypography.title),
          const SizedBox(height: AppSpacing.s2),
          if (rows.isEmpty)
            Text(
              'No meals configured for this day.',
              style: AppTypography.meta.copyWith(color: AppColors.inkMid),
            )
          else
            ...rows.map(
              (Widget row) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.s2),
                child: row,
              ),
            ),
        ],
      ),
    );
  }
}

class _FilledRow extends StatelessWidget {
  const _FilledRow({required this.item});

  final MenuItem item;

  @override
  Widget build(BuildContext context) => PCard(
    key: AutoFillPreviewScreen.filledKey(item.id),
    child: Row(
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
              Text(
                item.recipe.title,
                style: AppTypography.bodyStrong,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        Text(
          'Already planned',
          style: AppTypography.meta.copyWith(color: AppColors.inkMid),
        ),
      ],
    ),
  );
}

class _ProposedRow extends StatelessWidget {
  const _ProposedRow({super.key, required this.item});

  final ProposedMenuItem item;

  @override
  Widget build(BuildContext context) => PCard(
    child: Row(
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
              Text(
                item.recipe.title,
                style: AppTypography.bodyStrong,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        // A visible label, not just the icon — same "status conveyed by
        // text, not colour/icon alone" rule `_FilledRow`'s "Already
        // planned" and `_UnfilledRow`'s own detail text both already
        // follow, so a screen-reader user hears the same distinction a
        // sighted one sees.
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.auto_awesome, color: AppColors.terracotta, size: 16),
            const SizedBox(width: AppSpacing.s0),
            Text(
              'Auto-fill pick',
              style: AppTypography.meta.copyWith(color: AppColors.terracottaDeep),
            ),
          ],
        ),
      ],
    ),
  );
}

class _UnfilledRow extends StatelessWidget {
  const _UnfilledRow({super.key, required this.roleLabel});

  final String roleLabel;

  @override
  Widget build(BuildContext context) => PCard(
    child: Row(
      children: <Widget>[
        const Icon(
          Icons.remove_circle_outline,
          color: AppColors.inkMid,
          size: 16,
        ),
        const SizedBox(width: AppSpacing.s1),
        Expanded(
          child: Text(
            '$roleLabel — no recipe available',
            style: AppTypography.meta.copyWith(color: AppColors.inkMid),
          ),
        ),
      ],
    ),
  );
}

/// The post-commit view — [AutoFillResult]'s OWN `filledCount`/
/// `unfilledSlots`, never the earlier preview's, per this file's
/// [_fillSummaryHeadline] doc.
class _CommittedSummary extends StatelessWidget {
  const _CommittedSummary({required this.result, required this.onDone});

  final AutoFillResult result;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(AppSpacing.s3),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          _fillSummaryHeadline(result.filledCount, result.unfilledSlots),
          key: AutoFillPreviewScreen.committedSummaryKey,
          style: AppTypography.title,
        ),
        if (result.unfilledSlots.isNotEmpty) ...<Widget>[
          const SizedBox(height: AppSpacing.s1),
          Text(
            _unfilledDetail(result.unfilledSlots),
            style: AppTypography.label.copyWith(color: AppColors.inkMid),
          ),
        ],
        const SizedBox(height: AppSpacing.s3),
        PButton(
          key: AutoFillPreviewScreen.doneButtonKey,
          label: 'Done',
          onPressed: onDone,
        ),
      ],
    ),
  );
}
