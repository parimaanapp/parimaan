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
            final Menu menuValue => _TodayBody(menu: menuValue),
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
  const _TodayBody({required this.menu});

  final Menu menu;

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
        child: PCard(
          key: itemKey(items[i].id),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                items[i].slotRole.displayLabel,
                style: AppTypography.meta.copyWith(color: AppColors.inkMid),
              ),
              const SizedBox(height: AppSpacing.s1),
              Text(items[i].recipe.title, style: AppTypography.bodyStrong),
            ],
          ),
        ),
      ),
    );
  }
}
