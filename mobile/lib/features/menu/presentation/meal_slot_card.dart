import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/meal_slot_plan.dart';

/// One slot on the Weekly plan grid (E2E_MVP_PLAN.md §15.3 S5) — filled
/// (shows the placed recipe's title and role) or empty (a tappable "+",
/// PRD §6's locked no-drag-and-drop "+ add" pattern; there is no separate
/// "remove" affordance on this card — that is `removeMenuItem`, reached from
/// a filled slot's own tap in a later slice, not here).
///
/// A feature-local widget rather than a tenth-plus `p_meal_slot.dart`
/// design-system component (§15.3 S5's own "decide against the existing
/// ten's own bar" note) — nothing outside `features/menu/` needs this shape
/// yet, and every existing shared component earns its place by being reused
/// across multiple, unrelated features (`PCard`, `PButton`, ...), which this
/// is not.
class MealSlotCard extends StatelessWidget {
  const MealSlotCard({
    super.key,
    required this.slot,
    required this.dayOfWeek,
    required this.slotIndex,
    required this.onTap,
  });

  final PlannedSlot slot;

  /// The day this slot belongs to — [PlannedSlot] itself is day-agnostic
  /// (`plannedSlotsForDay` is called once per day), so the caller supplies
  /// it here purely to build a collision-free [emptyKey].
  final int dayOfWeek;

  /// This slot's position among every [PlannedSlot] for the same
  /// `(dayOfWeek, mealType, slotRole)` triple (e.g. the second of two
  /// `sabziDal` slots) — folded into [emptyKey] so two empty slots in the
  /// same day/role don't collide on Flutter's own sibling-`Key`-uniqueness
  /// requirement. A filled slot doesn't need this: its `MenuItem.id` is
  /// already globally unique.
  final int slotIndex;

  /// Fires on ANY tap — filled or empty. A filled slot's own tap target is
  /// exactly the same size and shape as an empty one's (see this file's own
  /// class doc: there is no remove affordance here yet), so today it always
  /// means "go look at what's in/could go in this slot," differentiated by
  /// [onTap]'s own caller-supplied destination logic, not by two separate
  /// callbacks here.
  final VoidCallback onTap;

  static Key filledKey(String menuItemId) =>
      Key('meal-slot-filled-$menuItemId');
  static Key emptyKey(
    int dayOfWeek,
    String mealType,
    String slotRole,
    int slotIndex,
  ) => Key('meal-slot-empty-$dayOfWeek-$mealType-$slotRole-$slotIndex');

  @override
  Widget build(BuildContext context) {
    final String roleLabel = slot.slotRole.displayLabel;

    if (slot.isFilled) {
      final String title = slot.item!.recipe.title;
      return PCard(
        key: filledKey(slot.item!.id),
        onTap: onTap,
        semanticLabel: '$roleLabel: $title',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              roleLabel,
              style: AppTypography.meta.copyWith(color: AppColors.inkMid),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              title,
              style: AppTypography.bodyStrong,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      );
    }

    return PCard(
      key: emptyKey(
        dayOfWeek,
        slot.mealType.wireValue,
        slot.slotRole.name,
        slotIndex,
      ),
      onTap: onTap,
      semanticLabel: 'Add a $roleLabel recipe',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.add, color: AppColors.terracotta, size: 20),
          const SizedBox(width: AppSpacing.s1),
          Text(
            roleLabel,
            style: AppTypography.meta.copyWith(color: AppColors.inkMid),
          ),
        ],
      ),
    );
  }
}
