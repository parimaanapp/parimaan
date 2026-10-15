import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/current_week.dart';
import '../domain/meal_slot_plan.dart';
import '../domain/menu.dart';
import '../state/current_menu_controller.dart';
import 'day_overflow_menu.dart';
import 'week_overflow_menu.dart';
import 'weekly_plan_grid.dart';

export 'weekday_names.dart' show weekdayNames;

/// Wireframe screen "Weekly plan" (E2E_MVP_PLAN.md §15.1/§15.3, rebuilt in
/// Build C slice C1, §32.6 item 7).
///
/// A week header (‹ date range ›, one dark "Auto-fill empty slots" action)
/// above [WeeklyPlanGrid]: four planned meals render each day as a card
/// with a 2x2 block of meal cells (option B); one to three render one
/// column per planned meal under a header row (option C).
///
/// The "Plan" shell tab — no back button. Resolves its household via
/// [activeHouseholdProvider], same convention as `PantryListScreen`/
/// `TodayScreen`.
class WeeklyPlanScreen extends ConsumerWidget {
  const WeeklyPlanScreen({super.key, this.today});

  /// "Now", injectable for tests; defaults to `DateTime.now()`.
  final DateTime? today;

  static const Key loadingKey = Key('weekly-plan-loading');
  static const Key errorKey = Key('weekly-plan-error');

  /// The dark "Auto-fill empty slots" action — pushes
  /// `AppRoutes.autoFillPreview`, keyed by the DISPLAYED week's [MenuKey] so
  /// that screen reads/writes the exact same `CurrentMenuController` family
  /// member this one does.
  static const Key autoFillButtonKey = Key('weekly-plan-auto-fill');

  /// The "Generate shopping list" trailing action (W11 S6) — pushes
  /// `AppRoutes.shoppingListGeneratedPrompt` with the DISPLAYED week's
  /// `menuId`.
  static const Key generateShoppingListButtonKey = Key(
    'weekly-plan-generate-shopping-list',
  );

  /// The week-level Overflow action (W14 S8): "Clear week"/"Copy to next
  /// week".
  static const Key weekOverflowButtonKey = Key('weekly-plan-week-overflow');

  static const Key previousWeekKey = Key('weekly-plan-previous-week');
  static const Key nextWeekKey = Key('weekly-plan-next-week');
  static const Key weekRangeKey = Key('weekly-plan-week-range');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: household == null
            ? const Center(
                key: WeeklyPlanScreen.loadingKey,
                child: CircularProgressIndicator(),
              )
            : _WeeklyPlanForHousehold(householdId: household.id, today: today),
      ),
    );
  }
}

/// How many weeks either side of the current one the ‹ › arrows reach.
/// Showing a week get-or-creates its menu server-side, so this is bounded
/// rather than unlimited.
const int _maxWeekOffset = 4;

class _WeeklyPlanForHousehold extends ConsumerStatefulWidget {
  const _WeeklyPlanForHousehold({required this.householdId, this.today});

  final String householdId;
  final DateTime? today;

  @override
  ConsumerState<_WeeklyPlanForHousehold> createState() =>
      _WeeklyPlanForHouseholdState();
}

class _WeeklyPlanForHouseholdState
    extends ConsumerState<_WeeklyPlanForHousehold> {
  int _weekOffset = 0;

  void _shiftWeek(int delta) => setState(
    () => _weekOffset = (_weekOffset + delta).clamp(
      -_maxWeekOffset,
      _maxWeekOffset,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final DateTime now = widget.today ?? DateTime.now();
    final DateTime weekStartDate = currentWeekStartDate(today: now)
        .add(Duration(days: 7 * _weekOffset));
    final MenuKey menuKey = menuKeyFor(widget.householdId, weekStartDate);
    final AsyncValue<Menu> menu = ref.watch(
      currentMenuControllerProvider(menuKey),
    );
    final int? todayDayOfWeek = _weekOffset == 0 ? now.weekday - 1 : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PTopBar(
          title: 'Weekly plan',
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              PButton.icon(
                key: WeeklyPlanScreen.generateShoppingListButtonKey,
                icon: Icons.checklist,
                semanticLabel: 'Generate shopping list',
                variant: PButtonVariant.ghost,
                // Disabled until the menu has resolved — its `id` is what
                // `menuId` carries, never a stale or missing one.
                onPressed: menu.valueOrNull == null
                    ? null
                    : () => context.push(
                        AppRoutes.shoppingListGeneratedPrompt,
                        extra: (
                          menuId: menu.valueOrNull!.id,
                          householdId: widget.householdId,
                        ),
                      ),
              ),
              PButton.icon(
                key: WeeklyPlanScreen.weekOverflowButtonKey,
                icon: Icons.more_vert,
                semanticLabel: 'More week actions',
                variant: PButtonVariant.ghost,
                onPressed: menu.valueOrNull == null
                    ? null
                    : () => showModalBottomSheet<void>(
                        context: context,
                        backgroundColor: AppColors.paper,
                        builder: (BuildContext context) =>
                            WeekOverflowMenu(menuKey: menuKey),
                      ),
              ),
            ],
          ),
        ),
        _WeekHeader(
          weekStartDate: weekStartDate,
          onPrevious: _weekOffset <= -_maxWeekOffset
              ? null
              : () => _shiftWeek(-1),
          onNext: _weekOffset >= _maxWeekOffset ? null : () => _shiftWeek(1),
          onAutoFill: () =>
              context.push(AppRoutes.autoFillPreview, extra: menuKey),
        ),
        Expanded(
          // A value wins over a spinner if one exists.
          child: switch (menu.valueOrNull) {
            final Menu menuValue => WeeklyPlanGrid(
              // Grid reads the menu's own frozen meal config (W14 S4), not
              // the household's live settings.
              menu: menuValue,
              todayDayOfWeek: todayDayOfWeek,
              onAddToSlot: (int dayOfWeek, PlannedSlot slot) => context.push(
                AppRoutes.recipePicker,
                extra: (
                  dayOfWeek: dayOfWeek,
                  mealSlot: slot.mealType.wireValue,
                  slotRole: slot.slotRole,
                  weekStartDate: weekStartDate,
                ),
              ),
              onDayMenu: (int dayOfWeek) => showModalBottomSheet<void>(
                context: context,
                backgroundColor: AppColors.paper,
                builder: (BuildContext context) =>
                    DayOverflowMenu(menuKey: menuKey, dayOfWeek: dayOfWeek),
              ),
            ),
            _ when menu.hasError => Center(
              key: WeeklyPlanScreen.errorKey,
              child: _LoadFailed(
                error: menu.error,
                onRetry: () =>
                    ref.invalidate(currentMenuControllerProvider(menuKey)),
              ),
            ),
            _ => const Center(
              key: WeeklyPlanScreen.loadingKey,
              child: CircularProgressIndicator(),
            ),
          },
        ),
      ],
    );
  }
}

const List<String> _monthAbbreviations = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// "12 – 18 Oct", or "26 Oct – 1 Nov" when the week crosses a month.
String weekRangeLabel(DateTime weekStartDate) {
  final DateTime end = weekStartDate.add(const Duration(days: 6));
  final String startMonth = _monthAbbreviations[weekStartDate.month - 1];
  final String endMonth = _monthAbbreviations[end.month - 1];
  return weekStartDate.month == end.month
      ? '${weekStartDate.day} – ${end.day} $endMonth'
      : '${weekStartDate.day} $startMonth – ${end.day} $endMonth';
}

class _WeekHeader extends StatelessWidget {
  const _WeekHeader({
    required this.weekStartDate,
    required this.onPrevious,
    required this.onNext,
    required this.onAutoFill,
  });

  final DateTime weekStartDate;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;
  final VoidCallback onAutoFill;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s1),
    child: Column(
      children: <Widget>[
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            PButton.icon(
              key: WeeklyPlanScreen.previousWeekKey,
              icon: Icons.chevron_left,
              semanticLabel: 'Previous week',
              variant: PButtonVariant.ghost,
              onPressed: onPrevious,
            ),
            Flexible(
              child: Text(
                weekRangeLabel(weekStartDate),
                key: WeeklyPlanScreen.weekRangeKey,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.title,
              ),
            ),
            PButton.icon(
              key: WeeklyPlanScreen.nextWeekKey,
              icon: Icons.chevron_right,
              semanticLabel: 'Next week',
              variant: PButtonVariant.ghost,
              onPressed: onNext,
            ),
          ],
        ),
        Semantics(
          button: true,
          label: 'Auto-fill empty slots',
          excludeSemantics: true,
          onTap: onAutoFill,
          child: Material(
            color: AppColors.ink,
            borderRadius: AppRadius.borderM,
            child: InkWell(
              key: WeeklyPlanScreen.autoFillButtonKey,
              onTap: onAutoFill,
              borderRadius: AppRadius.borderM,
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  minHeight: AppSizing.minTouchTargetHeight,
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.s2,
                  ),
                  child: Center(
                    child: Text(
                      '◆ Auto-fill empty slots',
                      style: AppTypography.label.copyWith(
                        color: AppColors.paper,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

/// Same shape as `PantryListScreen`/`SettingsHubScreen`'s own load-failure
/// state: a real `PEmptyState`, an `AppError`-narrowed message, and a "Try
/// again" retry affordance.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.error, required this.onRetry});

  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final Object? currentError = error;
    return PEmptyState(
      headline: 'Could not load the weekly plan',
      body: currentError is AppError ? currentError.errorMessage : '',
      action: PButton(
        label: 'Try again',
        variant: PButtonVariant.secondary,
        onPressed: onRetry,
      ),
    );
  }
}
