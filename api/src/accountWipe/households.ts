import type {
  HouseholdClassification,
  HouseholdWithMembers,
  KeptHousehold,
  PrimaryPromotion,
} from './types.js';

const byId = <T extends { readonly id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);

/**
 * Household rule (documented in docs/RUNBOOK.md):
 *   - every member in the wipe set (or no members at all) -> DELETE the household;
 *   - otherwise KEEP it, remove only the wiped members' memberships, and if the
 *     wiped user was the primary, promote the earliest-joined remaining member
 *     so the household is never left primary-less.
 * Households with no wipe-set involvement are ignored entirely.
 */
export const classifyHouseholds = (
  households: readonly HouseholdWithMembers[],
  wipedUserIds: ReadonlySet<string>,
): HouseholdClassification => {
  const deleted: { id: string; name: string }[] = [];
  const kept: KeptHousehold[] = [];
  const promotions: PrimaryPromotion[] = [];

  for (const household of [...households].sort(byId)) {
    const wiped = household.members.filter((m) => wipedUserIds.has(m.userId));
    const remaining = household.members.filter((m) => !wipedUserIds.has(m.userId));
    const primaryWiped =
      household.primaryUserId !== null && wipedUserIds.has(household.primaryUserId);

    if (remaining.length === 0) {
      deleted.push({ id: household.id, name: household.name });
      continue;
    }
    if (wiped.length === 0 && !primaryWiped) {
      continue;
    }

    kept.push({
      id: household.id,
      name: household.name,
      remainingMemberCount: remaining.length,
      wipedMemberCount: wiped.length,
    });

    if (primaryWiped) {
      const successor = [...remaining].sort(
        (a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId),
      )[0];
      if (successor !== undefined) {
        promotions.push({
          householdId: household.id,
          membershipId: successor.membershipId,
          newPrimaryUserId: successor.userId,
        });
      }
    }
  }

  return { deleted, kept, promotions };
};
