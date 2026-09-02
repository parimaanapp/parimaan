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
import '../domain/meal_slot_plan.dart';
import '../domain/menu.dart';
import '../state/current_menu_controller.dart';
import 'meal_slot_card.dart';

/// The seven weekday names for `Menu.dayOfWeek: 0..6` — `0` is Monday, per
/// this codebase's own migration/test precedent (`Menu.itemsForDay`'s own
/// doc, `domain/current_week.dart`'s `currentWeekStartDate`).
const List<String> _weekdayNames = <String>[
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
    final MenuKey key = menuKeyFor(householdId, weekStartDate);

    final AsyncValue<Menu> menu = ref.watch(currentMenuControllerProvider(key));
    // `HouseholdSettings` is already a field on `Household` — no separate
    // settings-read controller needed; `CurrentHouseholdController` is the
    // one source for it, same as `SettingsHubScreen`'s own read.
    final AsyncValue<Household> household = ref.watch(
      currentHouseholdControllerProvider(householdId),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const PTopBar(title: 'Weekly plan'),
        Expanded(
          // A value wins over a spinner if one exists — `valueOrNull`, not
          // `value` (SettingsHubScreen's own established shape) — both
          // providers need a value before the grid can render at all.
          child: switch ((menu.valueOrNull, household.valueOrNull)) {
            (final Menu menuValue, final Household householdValue) => _WeekBody(
              menu: menuValue,
              settings: householdValue.settings,
              householdId: householdId,
            ),
            _ when menu.hasError || household.hasError => Center(
              key: WeeklyPlanScreen.errorKey,
              child: _LoadFailed(
                error: menu.error ?? household.error,
                onRetry: () {
                  ref.invalidate(currentMenuControllerProvider(key));
                  ref.invalidate(
                    currentHouseholdControllerProvider(householdId),
                  );
                },
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
  });

  final Menu menu;
  final HouseholdSettings settings;
  final String householdId;

  @override
  Widget build(BuildContext context) => ListView.builder(
    padding: const EdgeInsets.all(AppSpacing.s3),
    itemCount: _weekdayNames.length,
    itemBuilder: (BuildContext context, int dayOfWeek) => _DaySection(
      dayOfWeek: dayOfWeek,
      dayName: _weekdayNames[dayOfWeek],
      slots: plannedSlotsForDay(settings, menu.itemsForDay(dayOfWeek)),
      householdId: householdId,
    ),
  );
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.dayOfWeek,
    required this.dayName,
    required this.slots,
    required this.householdId,
  });

  final int dayOfWeek;
  final String dayName;
  final List<PlannedSlot> slots;
  final String householdId;

  @override
  Widget build(BuildContext context) {
    // Each slot's 0-based position among every OTHER slot sharing its own
    // `(mealType, slotRole)` triple, for `MealSlotCard.emptyKey`'s
    // collision-free key. A running per-triple count keyed by a `Map`
    // rather than a reset-on-change counter — deliberately NOT assuming
    // `plannedSlotsForDay` emits same-triple slots contiguously, so this
    // stays correct even if that function's own emission order ever
    // changes (grouped/sorted differently, items interleaved across
    // roles, ...).
    final Map<String, int> countByTriple = <String, int>{};
    final List<int> indexWithinTriple = <int>[];
    for (final PlannedSlot slot in slots) {
      final String tripleKey = '${slot.mealType.name}-${slot.slotRole.name}';
      final int index = countByTriple[tripleKey] ?? 0;
      indexWithinTriple.add(index);
      countByTriple[tripleKey] = index + 1;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(dayName, style: AppTypography.title),
          const SizedBox(height: AppSpacing.s2),
          if (slots.isEmpty)
            Text(
              'No meals configured for this day.',
              style: AppTypography.meta.copyWith(color: AppColors.inkMid),
            )
          else
            ...List<Widget>.generate(
              slots.length,
              (int i) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.s2),
                child: MealSlotCard(
                  slot: slots[i],
                  dayOfWeek: dayOfWeek,
                  slotIndex: indexWithinTriple[i],
                  // A filled slot has no view/replace/remove destination
                  // yet (meal_slot_card.dart's own doc) — routing it to
                  // the SAME picker as an empty slot would silently let a
                  // second recipe be added to an already-filled slot
                  // (W10 S5's own review pass caught this). `null` here
                  // renders that card non-interactive until a later slice
                  // gives it a real destination, rather than a misleading
                  // one now.
                  onTap: slots[i].isFilled
                      ? null
                      : () => context.push(
                          AppRoutes.recipePicker,
                          extra: (
                            dayOfWeek: dayOfWeek,
                            mealSlot: slots[i].mealType.wireValue,
                            slotRole: slots[i].slotRole,
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
