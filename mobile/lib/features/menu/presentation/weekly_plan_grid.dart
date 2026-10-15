import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/domain/meal_type.dart';
import '../domain/meal_instance_plan.dart';
import '../domain/meal_slot_plan.dart';
import '../domain/menu.dart';
import 'weekday_names.dart';

/// The week's seven day cards (Build C, C1; `docs/wireframes/
/// weekly-plan-layouts-v1.html` options B and C).
///
/// * Four planned meals: **option B**. Each day is a card with the day label
///   on the left and a 2x2 grid of meal cells. No column header; each cell
///   names its own meal.
/// * One to three planned meals: **option C**. One column per planned meal,
///   with a small header row (pinned above the day cards).
///
/// Presentation only: it renders [menu] (its own frozen
/// `mealConfigSettings`) and reports taps through [onAddToSlot] and
/// [onDayMenu]. A cell shows ALL of its meal's slots (a lunch with several
/// slots lists every recipe); tapping it reports the first EMPTY slot of
/// that meal, and does nothing once every slot is filled, same as the
/// previous per-slot cards (a filled slot has no replace/remove destination
/// yet).
class WeeklyPlanGrid extends StatelessWidget {
  const WeeklyPlanGrid({
    super.key,
    required this.menu,
    required this.todayDayOfWeek,
    required this.onAddToSlot,
    required this.onDayMenu,
  });

  final Menu menu;

  /// Day index (0 = Monday) to outline as today; `null` outlines none (a
  /// week other than the current one).
  final int? todayDayOfWeek;

  final void Function(int dayOfWeek, PlannedSlot emptySlot) onAddToSlot;

  /// Opens the per-day overflow menu (copy/clear day).
  final void Function(int dayOfWeek) onDayMenu;

  static const Key blockLayoutKey = Key('weekly-plan-layout-block');
  static const Key columnLayoutKey = Key('weekly-plan-layout-columns');
  static const Key plusKey = Key('weekly-plan-cell-plus');
  static const Key cellSurfaceKey = Key('weekly-plan-cell-surface');
  static const Key overflowCountKey = Key('weekly-plan-cell-more');
  static const Key remainingKey = Key('weekly-plan-cell-remaining');

  static Key cellKey(int dayOfWeek, MealType mealType) =>
      Key('plan-cell-$dayOfWeek-${mealType.wireValue}');
  static Key dayCardKey(int dayOfWeek) => Key('plan-day-card-$dayOfWeek');
  static Key columnHeaderKey(MealType mealType) =>
      Key('plan-column-header-${mealType.wireValue}');

  /// Preserved from the pre-C1 per-day overflow trigger so existing
  /// callers/tests keep one stable key.
  static Key dayMenuKey(int dayOfWeek) =>
      Key('day-section-overflow-$dayOfWeek');

  /// Width of the day-label column; shared with the column header row so
  /// the headers line up with the cells beneath. At least a 44 pt tap
  /// target, growing with the text scale (capped so cells keep room).
  static double _labelWidthOf(BuildContext context) =>
      MediaQuery.textScalerOf(context)
          .scale(AppSizing.minTouchTargetWidth)
          .clamp(44.0, 66.0);

  static const double _borderWidth = 1.5;
  static const double _gap = AppSpacing.s0;

  @override
  Widget build(BuildContext context) {
    final _PlanView view = _view();
    if (view.meals.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: Text(
            'No meals configured for this week.',
            style: AppTypography.body.copyWith(color: AppColors.inkMid),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    final bool block = view.meals.length == MealType.values.length;
    return Column(
      key: block ? blockLayoutKey : columnLayoutKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (!block)
          _ColumnHeaders(meals: view.meals, labelWidth: _labelWidthOf(context)),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsetsDirectional.fromSTEB(
              AppSpacing.s1,
              AppSpacing.s1,
              AppSpacing.s1,
              AppSpacing.s3,
            ),
            itemCount: weekdayNames.length,
            itemBuilder: (BuildContext context, int day) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s1),
              child: _DayCard(
                dayOfWeek: day,
                dateOfMonth: menu.weekStartDate.add(Duration(days: day)).day,
                isToday: day == todayDayOfWeek,
                labelWidth: _labelWidthOf(context),
                block: block,
                meals: view.meals,
                groups: view.groupsForDay(day),
                onAddToSlot: onAddToSlot,
                onDayMenu: onDayMenu,
              ),
            ),
          ),
        ),
      ],
    );
  }

  _PlanView _view() {
    final HouseholdSettings settings = menu.mealConfigSettings;
    // Planned meals never vary by day: they come from the frozen config.
    final List<MealType> meals = groupSlotsByMealInstance(
      plannedSlotsForDay(settings, const <MenuItem>[]),
    ).map((MealInstanceGroup g) => g.mealType).toList(growable: false);
    return _PlanView(
      meals: meals,
      groupsForDay: (int day) => <MealType, List<PlannedSlot>>{
        for (final MealInstanceGroup g in groupSlotsByMealInstance(
          plannedSlotsForDay(settings, menu.itemsForDay(day)),
        ))
          g.mealType: g.slots,
      },
    );
  }
}

/// Derived, render-ready view of a menu's meal config.
class _PlanView {
  const _PlanView({required this.meals, required this.groupsForDay});

  final List<MealType> meals;
  final Map<MealType, List<PlannedSlot>> Function(int day) groupsForDay;
}

Color _fillFor(MealType meal) => switch (meal) {
  MealType.breakfast => AppColors.haldi,
  MealType.lunch => AppColors.terracottaDeep,
  MealType.snacks => AppColors.inkSoft,
  MealType.dinner => AppColors.cardamom,
};

Color _onFillFor(MealType meal) =>
    meal == MealType.breakfast ? AppColors.ink : AppColors.paper;

class _ColumnHeaders extends StatelessWidget {
  const _ColumnHeaders({required this.meals, required this.labelWidth});

  final List<MealType> meals;
  final double labelWidth;

  @override
  Widget build(BuildContext context) {
    const double inset =
        AppSpacing.s1 + AppSpacing.s1 + WeeklyPlanGrid._borderWidth;
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        inset,
        AppSpacing.s1,
        inset,
        0,
      ),
      child: Row(
        children: <Widget>[
          SizedBox(width: labelWidth + WeeklyPlanGrid._gap),
          for (int i = 0; i < meals.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: WeeklyPlanGrid._gap),
            Expanded(
              child: Text(
                meals[i].displayLabel.toUpperCase(),
                key: WeeklyPlanGrid.columnHeaderKey(meals[i]),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _monoLabel.copyWith(color: AppColors.inkSoft),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

final TextStyle _monoLabel = AppTypography.mono.copyWith(
  fontSize: 11,
  height: 14 / 11,
  letterSpacing: 0.6,
  fontWeight: FontWeight.w600,
);

class _DayCard extends StatelessWidget {
  const _DayCard({
    required this.dayOfWeek,
    required this.dateOfMonth,
    required this.isToday,
    required this.labelWidth,
    required this.block,
    required this.meals,
    required this.groups,
    required this.onAddToSlot,
    required this.onDayMenu,
  });

  final int dayOfWeek;
  final int dateOfMonth;
  final bool isToday;
  final double labelWidth;
  final bool block;
  final List<MealType> meals;
  final Map<MealType, List<PlannedSlot>> groups;
  final void Function(int, PlannedSlot) onAddToSlot;
  final void Function(int) onDayMenu;

  Widget _cell(MealType meal) => _MealCell(
    dayOfWeek: dayOfWeek,
    meal: meal,
    slots: groups[meal] ?? const <PlannedSlot>[],
    isToday: isToday,
    showMealLabel: block,
    onAddToSlot: onAddToSlot,
  );

  Widget _row(List<MealType> rowMeals) => IntrinsicHeight(
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (int i = 0; i < rowMeals.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: WeeklyPlanGrid._gap),
          Expanded(child: _cell(rowMeals[i])),
        ],
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final Widget cells = block
        ? Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _row(meals.sublist(0, 2)),
              const SizedBox(height: WeeklyPlanGrid._gap),
              _row(meals.sublist(2)),
            ],
          )
        : _row(meals);

    return Container(
      key: WeeklyPlanGrid.dayCardKey(dayOfWeek),
      padding: const EdgeInsets.all(AppSpacing.s1),
      decoration: BoxDecoration(
        borderRadius: AppRadius.borderM,
        color: isToday
            ? AppColors.terracotta.withValues(alpha: 0.04)
            : AppColors.card,
        border: Border.all(
          width: WeeklyPlanGrid._borderWidth,
          color: isToday ? AppColors.terracotta : AppColors.paper2,
        ),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            SizedBox(
              width: labelWidth,
              child: _DayLabel(
                dayOfWeek: dayOfWeek,
                dateOfMonth: dateOfMonth,
                isToday: isToday,
                onTap: () => onDayMenu(dayOfWeek),
              ),
            ),
            const SizedBox(width: WeeklyPlanGrid._gap),
            Expanded(child: cells),
          ],
        ),
      ),
    );
  }
}

class _DayLabel extends StatelessWidget {
  const _DayLabel({
    required this.dayOfWeek,
    required this.dateOfMonth,
    required this.isToday,
    required this.onTap,
  });

  final int dayOfWeek;
  final int dateOfMonth;
  final bool isToday;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String name = weekdayNames[dayOfWeek];
    return Semantics(
      button: true,
      label: 'More $name actions${isToday ? ', today' : ''}',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        key: WeeklyPlanGrid.dayMenuKey(dayOfWeek),
        onTap: onTap,
        borderRadius: AppRadius.borderS,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: AppSizing.minTouchTargetHeight,
          ),
          child: Align(
            alignment: AlignmentDirectional.topStart,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  name.substring(0, 3),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.bodyStrong,
                ),
                Text(
                  '$dateOfMonth',
                  maxLines: 1,
                  style: AppTypography.mono.copyWith(
                    fontSize: 11,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MealCell extends StatelessWidget {
  const _MealCell({
    required this.dayOfWeek,
    required this.meal,
    required this.slots,
    required this.isToday,
    required this.showMealLabel,
    required this.onAddToSlot,
  });

  final int dayOfWeek;
  final MealType meal;
  final List<PlannedSlot> slots;
  final bool isToday;
  final bool showMealLabel;
  final void Function(int, PlannedSlot) onAddToSlot;

  static const int _maxTitles = 3;

  List<String> get _titles => slots
      .where((PlannedSlot s) => s.isFilled)
      .map((PlannedSlot s) => s.item!.recipe.title)
      .toList(growable: false);

  PlannedSlot? get _nextEmpty {
    for (final PlannedSlot s in slots) {
      if (!s.isFilled) return s;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final List<String> titles = _titles;
    final bool isEmpty = titles.isEmpty;
    final PlannedSlot? target = _nextEmpty;
    final int remaining = slots.length - titles.length;
    final bool partial = !isEmpty && remaining > 0;
    final VoidCallback? onTap = target == null
        ? null
        : () => onAddToSlot(dayOfWeek, target);
    final String status = isEmpty
        ? 'empty, add a recipe'
        : '${titles.join(', ')}'
              '${partial ? '; ${titles.length} of ${slots.length} filled, '
                        'next: ${target!.slotRole.displayLabel}' : ''}';
    final String label =
        '${isToday ? 'Today, ' : ''}${weekdayNames[dayOfWeek]} '
        '${meal.displayLabel.toLowerCase()}: $status';

    final Color onFill = _onFillFor(meal);
    final String mealLabel = meal.displayLabel.toUpperCase();
    final bool collapse = titles.length > _maxTitles;
    final List<String> shown = collapse
        ? titles.take(_maxTitles - 1).toList(growable: false)
        : titles;
    final TextStyle titleStyle = AppTypography.body.copyWith(
      fontSize: 12,
      height: 15 / 12,
      fontWeight: FontWeight.w600,
      color: onFill,
    );

    final Widget content = isEmpty
        ? Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Text(
                '＋',
                key: WeeklyPlanGrid.plusKey,
                style: AppTypography.title.copyWith(
                  color: AppColors.terracotta,
                  height: 1,
                ),
              ),
              if (showMealLabel)
                Text(
                  mealLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: _monoLabel.copyWith(color: AppColors.inkSoft),
                ),
            ],
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              for (final String title in shown)
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: titleStyle,
                ),
              if (collapse)
                Text(
                  '+${titles.length - shown.length}',
                  key: WeeklyPlanGrid.overflowCountKey,
                  maxLines: 1,
                  style: titleStyle,
                ),
              const Spacer(),
              if (showMealLabel || partial)
                Row(
                  children: <Widget>[
                    if (showMealLabel)
                      Flexible(
                        child: Text(
                          mealLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: _monoLabel.copyWith(color: onFill),
                        ),
                      ),
                    if (showMealLabel && partial)
                      const SizedBox(width: AppSpacing.s0),
                    if (partial)
                      Text(
                        '＋$remaining',
                        key: WeeklyPlanGrid.remainingKey,
                        maxLines: 1,
                        style: _monoLabel.copyWith(color: onFill),
                      ),
                  ],
                ),
            ],
          );

    return Semantics(
      button: onTap != null,
      label: label,
      excludeSemantics: true,
      onTap: onTap,
      child: ConstrainedBox(
        key: WeeklyPlanGrid.cellKey(dayOfWeek, meal),
        constraints: BoxConstraints(
          minHeight: showMealLabel ? 56 : AppSizing.minTouchTargetHeight + 20,
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.borderS,
          child: Container(
            key: WeeklyPlanGrid.cellSurfaceKey,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.s1,
              vertical: AppSpacing.s0 + 2,
            ),
            decoration: BoxDecoration(
              borderRadius: AppRadius.borderS,
              color: isEmpty ? null : _fillFor(meal),
              border: isEmpty ? Border.all(color: AppColors.inkMid) : null,
            ),
            child: content,
          ),
        ),
      ),
    );
  }
}
