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
import '../../household/domain/meal_type.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/current_week.dart';
import '../domain/meal_instance_plan.dart';
import '../domain/meal_slot_plan.dart';
import '../domain/menu.dart';
import '../state/current_menu_controller.dart';
import 'day_overflow_menu.dart';
import 'meal_slot_card.dart';
import 'week_overflow_menu.dart';

/// The seven weekday names for `Menu.dayOfWeek: 0..6` — `0` is Monday, per
/// this codebase's own migration/test precedent (`Menu.itemsForDay`'s own
/// doc, `domain/current_week.dart`'s `currentWeekStartDate`).
///
/// Public (not `weekly_plan_screen.dart`-private) so `auto_fill_preview_screen.dart`'s
/// own day-by-day listing renders the same seven names rather than keeping a
/// second copy that could drift out of sync.
const List<String> weekdayNames = <String>[
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/// Wireframe screen "Weekly plan" (E2E_MVP_PLAN.md §15.1/§15.3 S5/S6) — a
/// 7-day grid, each day showing its household-configured meal slots, each
/// slot filled or addable. Rendered as seven stacked day SECTIONS in one
/// vertical scroll, not seven side-by-side columns — a judgment call (no
/// wireframe asset available to this implementation), chosen because a
/// literal 7-column grid does not fit a phone width at any useful slot size;
/// flagged here rather than presented as locked, same as every other
/// undocumented-in-the-wireframe call this codebase makes explicitly.
///
/// **A second, later judgment call, same discipline:** each day's slots are
/// grouped under one [MealInstanceHeader] row per meal instance —
/// Breakfast, Lunch, Snacks, Dinner, in that fixed order — instead of the
/// flat, undifferentiated slot list this screen originally rendered
/// (E2E_MVP_PLAN.md §19.2.5 D5, W13 S5). Like the seven-stacked-days call
/// above, no wireframe asset exists for this grouping — only the founder's
/// own ASCII sketch — so the specific rendering (a header row + indented
/// cards, inside the existing `_DaySection`) is this slice's own call,
/// flagged rather than presented as locked. The grouping itself comes from
/// `groupSlotsByMealInstance` (`domain/meal_instance_plan.dart`), which
/// derives nothing new — it only partitions `plannedSlotsForDay`'s own
/// output, so this screen still has exactly one place that decides *how
/// many* slots exist per meal type.
///
/// The "Plan" shell tab (S6) — no back button, same as `PantryListScreen`/
/// `RecipesLibraryScreen`'s own tab-root `PTopBar`s (a tab is a peer of
/// Home, not a screen pushed on top of it).
///
/// Resolves its household via [activeHouseholdProvider], same convention as
/// `PantryListScreen`/`TodayScreen` — this route carries no `:householdId`
/// path segment.
class WeeklyPlanScreen extends ConsumerWidget {
  const WeeklyPlanScreen({super.key});

  static const Key loadingKey = Key('weekly-plan-loading');
  static const Key errorKey = Key('weekly-plan-error');

  /// The "Auto-fill week" trailing action (W10 S6) — pushes
  /// `AppRoutes.autoFillPreview`, keyed by the CURRENT week's [MenuKey] so
  /// that screen reads/writes the exact same `CurrentMenuController` family
  /// member this one does.
  static const Key autoFillButtonKey = Key('weekly-plan-auto-fill');

  /// The "Generate shopping list" trailing action (W11 S6,
  /// E2E_MVP_PLAN.md §17.3 S6) — pushes `AppRoutes.shoppingListGeneratedPrompt`
  /// with the CURRENT week's `menuId` (this screen's own [MenuKey]'s
  /// `householdId`/[Menu.id], never a stale one held over from a previous
  /// week) so the flow generates a list for the exact menu on screen.
  static const Key generateShoppingListButtonKey = Key(
    'weekly-plan-generate-shopping-list',
  );

  /// The week-level Overflow action (W14 S8, E2E_MVP_PLAN.md §20.2.8/§20.3)
  /// — opens `WeekOverflowMenu`'s "Clear week"/"Copy to next week" sheet.
  /// See that widget's own doc for why this placement (next to the
  /// existing week-scoped trailing actions) is a flagged judgment call.
  static const Key weekOverflowButtonKey = Key('weekly-plan-week-overflow');

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
            : _WeeklyPlanForHousehold(householdId: household.id),
      ),
    );
  }
}

class _WeeklyPlanForHousehold extends ConsumerWidget {
  const _WeeklyPlanForHousehold({required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateTime weekStartDate = currentWeekStartDate();
    // `menuKey`, not `key` — a bare `key` reads as Flutter's own `Key`
    // (this file also defines `WeeklyPlanScreen.autoFillButtonKey`), and
    // this is a `MenuKey` record, not a widget key.
    final MenuKey menuKey = menuKeyFor(householdId, weekStartDate);

    final AsyncValue<Menu> menu = ref.watch(
      currentMenuControllerProvider(menuKey),
    );
    // No `currentHouseholdControllerProvider` watch here (dropped, W14 S4,
    // E2E_MVP_PLAN.md §20.2.4) — the meal config this screen renders now
    // comes from the CURRENT menu's own frozen [Menu.mealConfigSettings]
    // (below), not the household's live settings, and nothing else on this
    // screen reads any other `Household` field: `householdId` (this
    // widget's own constructor argument) is all every navigation/action
    // here ever needed. Checked, not assumed — see this slice's own PR
    // description for the audit.

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
                // Disabled until the menu (get-or-created by
                // `CurrentMenuController.build`) has actually resolved — its
                // own `id` is what `menuId` below carries, and this affordance
                // must never fire against a stale or missing one (S6's own
                // RED-test list: "never a stale one").
                onPressed: menu.valueOrNull == null
                    ? null
                    : () => context.push(
                        AppRoutes.shoppingListGeneratedPrompt,
                        extra: (
                          menuId: menu.valueOrNull!.id,
                          householdId: householdId,
                        ),
                      ),
              ),
              PButton.icon(
                key: WeeklyPlanScreen.autoFillButtonKey,
                icon: Icons.auto_awesome,
                semanticLabel: 'Auto-fill week',
                variant: PButtonVariant.ghost,
                onPressed: () =>
                    context.push(AppRoutes.autoFillPreview, extra: menuKey),
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
        Expanded(
          // A value wins over a spinner if one exists — `valueOrNull`, not
          // `value` (SettingsHubScreen's own established shape).
          child: switch (menu.valueOrNull) {
            final Menu menuValue => _WeekBody(
              menu: menuValue,
              // The snapshot-derived, `plannedSlotsForDay`-ready view over
              // THIS week's own frozen meal config (W14 S4,
              // E2E_MVP_PLAN.md §20.2.4) — not the household's live
              // settings, which may have changed since this menu was
              // created. `plannedSlotsForDay`'s own signature is unchanged:
              // it still takes a `HouseholdSettings`-shaped argument, just
              // sourced from a different place.
              settings: menuValue.mealConfigSettings,
              householdId: householdId,
              menuKey: menuKey,
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

/// Same shape as `PantryListScreen`/`SettingsHubScreen`'s own load-failure
/// state: a real `PEmptyState`, an `AppError`-narrowed message (never a raw
/// exception's own `toString()` leaking to the UI), and a "Try again" retry
/// affordance — not the dead-end raw-text state this originally shipped
/// with.
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

class _WeekBody extends StatelessWidget {
  const _WeekBody({
    required this.menu,
    required this.settings,
    required this.householdId,
    required this.menuKey,
  });

  final Menu menu;
  final HouseholdSettings settings;
  final String householdId;
  final MenuKey menuKey;

  @override
  Widget build(BuildContext context) => ListView.builder(
    padding: const EdgeInsets.all(AppSpacing.s3),
    itemCount: weekdayNames.length,
    itemBuilder: (BuildContext context, int dayOfWeek) => _DaySection(
      dayOfWeek: dayOfWeek,
      dayName: weekdayNames[dayOfWeek],
      slots: plannedSlotsForDay(settings, menu.itemsForDay(dayOfWeek)),
      householdId: householdId,
      menuKey: menuKey,
    ),
  );
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.dayOfWeek,
    required this.dayName,
    required this.slots,
    required this.householdId,
    required this.menuKey,
  });

  final int dayOfWeek;
  final String dayName;
  final List<PlannedSlot> slots;
  final String householdId;
  final MenuKey menuKey;

  /// Keyed per [dayOfWeek] so a widget test can find this exact day's
  /// overflow trigger (W14 S8) — same `Key(...$suffix)` convention
  /// `MealInstanceHeader.headerKey` already uses for a per-day/per-meal key.
  static Key overflowButtonKey(int dayOfWeek) =>
      Key('day-section-overflow-$dayOfWeek');

  @override
  Widget build(BuildContext context) {
    // `groupSlotsByMealInstance` derives nothing (domain/meal_instance_plan.dart's
    // own doc) — it only partitions this already-computed `slots` list by
    // meal type, preserving order and multiplicity exactly. A meal type
    // absent from `mealsEnabled` never appears in `slots` in the first
    // place, so it falls out of this call with no group and no header —
    // no separate branch needed here for "meal not planned".
    final List<MealInstanceGroup> groups = groupSlotsByMealInstance(slots);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: Text(dayName, style: AppTypography.title)),
              PButton.icon(
                key: _DaySection.overflowButtonKey(dayOfWeek),
                icon: Icons.more_horiz,
                semanticLabel: 'More $dayName actions',
                variant: PButtonVariant.ghost,
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  backgroundColor: AppColors.paper,
                  builder: (BuildContext context) =>
                      DayOverflowMenu(menuKey: menuKey, dayOfWeek: dayOfWeek),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.s2),
          if (groups.isEmpty)
            Text(
              'No meals configured for this day.',
              style: AppTypography.meta.copyWith(color: AppColors.inkMid),
            )
          else
            for (final MealInstanceGroup group in groups)
              _MealInstanceSection(dayOfWeek: dayOfWeek, group: group),
        ],
      ),
    );
  }
}

/// One meal instance's worth of rendering inside a [_DaySection] — a
/// [MealInstanceHeader] naming the meal, then that meal's own slot cards
/// beneath it, in [MealInstanceGroup.slots]' own order (E2E_MVP_PLAN.md
/// §19.2.5 D5, W13 S5).
class _MealInstanceSection extends StatelessWidget {
  const _MealInstanceSection({required this.dayOfWeek, required this.group});

  final int dayOfWeek;
  final MealInstanceGroup group;

  @override
  Widget build(BuildContext context) {
    // Each slot's 0-based position among every OTHER slot in THIS group
    // sharing its own `slotRole`, for `MealSlotCard.emptyKey`'s
    // collision-free key. Grouping by `slotRole` alone (not the
    // `mealType`-`slotRole` pair `_DaySection` used before this slice) is
    // equivalent here — every slot in [group] already shares one
    // `mealType` by construction — and stays correct however
    // `plannedSlotsForDay` orders same-role slots, same "don't assume
    // contiguous emission" reasoning as before.
    final Map<String, int> countByRole = <String, int>{};
    final List<int> indexWithinRole = <int>[];
    for (final PlannedSlot slot in group.slots) {
      final String roleKey = slot.slotRole.name;
      final int index = countByRole[roleKey] ?? 0;
      indexWithinRole.add(index);
      countByRole[roleKey] = index + 1;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          MealInstanceHeader(dayOfWeek: dayOfWeek, mealType: group.mealType),
          const SizedBox(height: AppSpacing.s1),
          ...List<Widget>.generate(
            group.slots.length,
            (int i) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s2),
              child: MealSlotCard(
                slot: group.slots[i],
                dayOfWeek: dayOfWeek,
                slotIndex: indexWithinRole[i],
                // A filled slot has no view/replace/remove destination
                // yet (meal_slot_card.dart's own doc) — routing it to
                // the SAME picker as an empty slot would silently let a
                // second recipe be added to an already-filled slot
                // (W10 S5's own review pass caught this). `null` here
                // renders that card non-interactive until a later slice
                // gives it a real destination, rather than a misleading
                // one now.
                onTap: group.slots[i].isFilled
                    ? null
                    : () => context.push(
                        AppRoutes.recipePicker,
                        extra: (
                          dayOfWeek: dayOfWeek,
                          mealSlot: group.slots[i].mealType.wireValue,
                          slotRole: group.slots[i].slotRole,
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A meal-instance header row inside [_DaySection] — one per
/// [MealInstanceGroup] `groupSlotsByMealInstance` produces, naming *which*
/// meal (Breakfast, Lunch, Snacks, Dinner) the cards beneath it belong to
/// (E2E_MVP_PLAN.md §19.2.5 D5 — the founder's own restructuring ask, the
/// reason this slice exists). Only [MealType]'s four real values ever
/// reach this widget — [MealInstanceHeader] renders whatever
/// [MealType.displayLabel] the caller hands it, and that enum has no
/// Sweet/Drink member to hand it (Q18) — so "no Sweet/Drink header" is
/// enforced by [MealType]'s own shape, not by a check here.
///
/// A small `StatelessWidget` of its own, not inlined into
/// [_MealInstanceSection], so it has a stable [headerKey] a test can find
/// directly, the same reason [MealSlotCard] exposes [MealSlotCard.filledKey]
/// / [MealSlotCard.emptyKey] rather than leaving callers to match on text.
class MealInstanceHeader extends StatelessWidget {
  const MealInstanceHeader({
    super.key,
    required this.dayOfWeek,
    required this.mealType,
  });

  final int dayOfWeek;
  final MealType mealType;

  static Key headerKey(int dayOfWeek, MealType mealType) =>
      Key('meal-instance-header-$dayOfWeek-${mealType.wireValue}');

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Text(
      mealType.displayLabel,
      key: headerKey(dayOfWeek, mealType),
      style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
    ),
  );
}
