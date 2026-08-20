/**
 * Maximum number of `household_memberships` rows a single household may
 * have. Enforced concurrency-safely by `repositories/householdRepository.ts`'s
 * `insertMembershipWithinCap` (a guarded conditional insert) together with
 * `resolvers/joinHousehold.ts`'s `SELECT ... FOR UPDATE` row lock on the
 * target household — see that resolver's own comments for why both layers
 * exist. Kept as a standalone constant (not inlined) so the cap is a single,
 * greppable source of truth shared by the resolver, the repository, and their
 * tests.
 */
export const HOUSEHOLD_MEMBER_CAP = 5;
