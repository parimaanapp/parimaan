import '../../household/domain/meal_type.dart';
import 'meal_slot_plan.dart';

/// One meal instance's worth of slots for a single day — Breakfast's one
/// slot, Lunch's carb/sabzi-dal/accompaniment instances, Snacks' one slot,
/// or Dinner's carb/sabzi-dal/accompaniment instances, however many of each
/// the household is configured for.
///
/// This exists purely as a rendering seam (E2E_MVP_PLAN.md §19.2.5 D5): the
/// weekly grid's own feedback was that a flat `List<PlannedSlot>` "reads as
/// an undifferentiated list," with nothing marking where one meal instance
/// ends and the next begins. `MealInstanceGroup` is that marker — a header
/// ([mealType]) plus the slots that belong under it — and nothing more.
/// It carries no counts, no cap information, and no settings: everything
/// about *how many* slots exist for a meal type was already decided by
/// [plannedSlotsForDay] before [slots] ever reaches this type.
class MealInstanceGroup {
  const MealInstanceGroup({required this.mealType, required this.slots});

  /// Which of the four meal types this group renders as a header for.
  final MealType mealType;

  /// This meal instance's slots, in the exact order and with the exact
  /// filled/empty status [plannedSlotsForDay] produced them in — never
  /// re-sorted, re-counted, or otherwise recomputed by this module.
  final List<PlannedSlot> slots;

  @override
  String toString() =>
      'MealInstanceGroup(mealType: ${mealType.name}, slots: ${slots.length})';
}

/// Regroups [plannedSlotsForDay]'s flat output into one [MealInstanceGroup]
/// per meal type present in [slots], so the weekly grid can render a header
/// per meal instance instead of one undifferentiated list per day
/// (E2E_MVP_PLAN.md §19.2.5 D5).
///
/// **This function derives nothing.** It does not read `mealsEnabled`, does
/// not decode `mealStructure`, and does not compute — or re-compute — any
/// cap rule; it only partitions an already-computed [slots] list by
/// [PlannedSlot.mealType], preserving input order. That its signature takes
/// no [HouseholdSettings]-shaped argument at all *is* the enforcement
/// mechanism the plan locks: §15.5.1 and §16.5.1 both name "the cap rule
/// now lives in N places" as this feature area's standing risk, and a
/// grouping function able to re-derive counts from settings would make this
/// module a third place that rule could drift into. If a caller ever needs
/// this function to behave differently for a given household, the fix is a
/// change to what list of [PlannedSlot]s it is handed — via
/// [plannedSlotsForDay] — never a parameter added here.
///
/// A meal type contributes no group at all when it contributes no slots to
/// [slots] — there is no special case for this; it is what "group by
/// `mealType`, skip empty groups" does automatically. In practice this
/// means a household with a meal type absent from `mealsEnabled` (Snacks
/// disabled, say) sees no header for it, because [plannedSlotsForDay]
/// never emitted any slot with that `mealType` in the first place.
///
/// Group order is exactly the order meal types first appear in [slots] —
/// which is [MealType.values] order, Breakfast → Lunch → Snacks → Dinner,
/// because that is the order [plannedSlotsForDay] already iterates in. This
/// function does not sort by [MealType.values] itself; it walks [slots]
/// once and lets a stable partition fall out, so a caller handing in slots
/// from any other order-preserving source gets that order preserved too,
/// rather than silently re-imposing Breakfast-first. Within a Lunch/Dinner
/// group, the same reasoning preserves `MealSlot.values` order (carb →
/// sabzi/dal → accompaniment) and multiplicity exactly as [slots] carried
/// them in — again inherited, not re-sorted or re-counted.
List<MealInstanceGroup> groupSlotsByMealInstance(List<PlannedSlot> slots) {
  final List<MealInstanceGroup> groups = <MealInstanceGroup>[];
  final Map<MealType, List<PlannedSlot>> bucketsByMealType =
      <MealType, List<PlannedSlot>>{};

  for (final PlannedSlot slot in slots) {
    final List<PlannedSlot>? existingBucket = bucketsByMealType[slot.mealType];
    if (existingBucket == null) {
      // First time this meal type has been seen: its position in `groups`
      // right now is exactly its first-appearance order in `slots`, which
      // is what gives group order Breakfast → Lunch → Snacks → Dinner
      // without ever sorting by MealType.values directly.
      final List<PlannedSlot> newBucket = <PlannedSlot>[slot];
      bucketsByMealType[slot.mealType] = newBucket;
      groups.add(MealInstanceGroup(mealType: slot.mealType, slots: newBucket));
    } else {
      existingBucket.add(slot);
    }
  }

  return groups;
}
