import type {
  HouseholdClassification,
  HouseholdWithMembers,
  KeptHousehold,
  PrimaryPromotion,
} from './types.js';

/** Surviving (non-wiped) members, counting a non-null non-wiped primary that has no membership row. */
const survivingCount = (
  household: HouseholdWithMembers,
  remaining: readonly { readonly userId: string }[],
  primaryWiped: boolean,
): number => {
  // A non-null primary that is not being wiped is a surviving member even if it
  // has no membership row (inconsistent data): never delete a household out from under it.
  const phantomPrimary =
    household.primaryUserId !== null &&
    !primaryWiped &&
    !remaining.some((m) => m.userId === household.primaryUserId);
  return remaining.length + (phantomPrimary ? 1 : 0);
};

const byId = <T extends { readonly id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);

/**
 * Household rule (documented in docs/RUNBOOK.md):
 *   - every member in the wipe set (or no members at all) and no surviving primary -> DELETE;
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

    const remainingCount = survivingCount(household, remaining, primaryWiped);

    if (remainingCount === 0) {
      deleted.push({ id: household.id, name: household.name });
      continue;
    }
    if (wiped.length === 0 && !primaryWiped) {
      continue;
    }

    kept.push({
      id: household.id,
      name: household.name,
      remainingMemberCount: remainingCount,
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
