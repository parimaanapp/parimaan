import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/pantry_category.dart';
import '../domain/pantry_item.dart';
import '../state/pantry_controller.dart';
import 'delete_pantry_item_dialog.dart';
import 'pantry_row.dart';

/// Wireframe screen 9.1 — the Pantry List. The Pantry tab of the W5 nav
/// shell (S4); reads the network only, no local cache and no subscription
/// (both later slices — S7, S8).
///
/// Resolves its household the same way `TodayScreen` does — via
/// `activeHouseholdProvider` — rather than taking a `householdId`
/// constructor parameter, since the shell route this renders under carries
/// no `:householdId` path segment.
class PantryListScreen extends ConsumerWidget {
  const PantryListScreen({super.key});

  static const Key emptyStateKey = Key('pantry-list-empty');
  static const Key errorStateKey = Key('pantry-list-error');
  static const Key searchFieldKey = Key('pantry-list-search');
  static const Key addButtonKey = Key('pantry-list-add');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: household == null
            ? const Center(child: CircularProgressIndicator())
            : _PantryForHousehold(householdId: household.id),
      ),
    );
  }
}

class _PantryForHousehold extends ConsumerWidget {
  const _PantryForHousehold({required this.householdId});

  final String householdId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<PantryItem>> pantry = ref.watch(
      pantryControllerProvider(householdId),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PTopBar(
          title: 'Pantry',
          trailing: PButton.icon(
            key: PantryListScreen.addButtonKey,
            icon: Icons.add,
            semanticLabel: 'Add a pantry item',
            variant: PButtonVariant.ghost,
            onPressed: () =>
                context.push(AppRoutes.pantryAddChooseMethod(householdId)),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.s3,
            AppSpacing.s3,
            AppSpacing.s3,
            AppSpacing.s2,
          ),
          child: PInput(
            key: PantryListScreen.searchFieldKey,
            label: 'Search',
            hintText: 'Search the pantry',
            prefixIcon: Icons.search,
            onChanged: (String value) => ref
                .read(pantryControllerProvider(householdId).notifier)
                .setSearch(value),
          ),
        ),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
            children: <Widget>[
              for (final String category in knownPantryCategories)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.s1),
                  child: PChip(
                    label: pantryCategoryLabel(category),
                    onTap: () => ref
                        .read(pantryControllerProvider(householdId).notifier)
                        .setCategory(category),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.s2),
        Expanded(
          child: switch ((pantry.valueOrNull, pantry.error)) {
            (final List<PantryItem> items, _) when items.isNotEmpty => ListView(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
              children: <Widget>[
                for (final PantryItem item in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.s1),
                    child: PantryRow(
                      item: item,
                      onTap: () => context.push(
                        AppRoutes.pantryManualAdd(householdId),
                        extra: item,
                      ),
                      onDelete: () => showDeletePantryItemDialog(
                        context: context,
                        item: item,
                      ),
                    ),
                  ),
              ],
            ),
            (final List<PantryItem> items, _) when items.isEmpty => Center(
              key: PantryListScreen.emptyStateKey,
              child: PEmptyState(
                headline: 'No pantry items yet',
                body: 'Add what\'s in your kitchen to get started.',
                action: PButton(
                  label: 'Add an item',
                  variant: PButtonVariant.secondary,
                  onPressed: () => context.push(
                    AppRoutes.pantryAddChooseMethod(householdId),
                  ),
                ),
              ),
            ),
            (null, final Object error) => Center(
              key: PantryListScreen.errorStateKey,
              child: PEmptyState(
                headline: 'Could not load the pantry',
                body: error is AppError ? error.errorMessage : '',
                action: PButton(
                  label: 'Try again',
                  variant: PButtonVariant.secondary,
                  onPressed: () =>
                      ref.invalidate(pantryControllerProvider(householdId)),
                ),
              ),
            ),
            _ => const Center(child: CircularProgressIndicator()),
          },
        ),
      ],
    );
  }
}
