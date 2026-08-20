import type { PoolClient } from 'pg';
import {
  DEFAULT_ALLERGENS,
  DEFAULT_CUISINE_TIER1,
  DEFAULT_CUISINE_TIER2_WEIGHTS,
  DEFAULT_DIETARY_TAGS,
  DEFAULT_MEALS_ENABLED,
  DEFAULT_MEAL_STRUCTURE,
  DEFAULT_SKIP_INGREDIENTS,
} from '../domain/householdDefaults.js';
import type { UserRow } from './userRepository.js';

export type SubscriptionStatus = 'free' | 'trial' | 'active' | 'past_due' | 'cancelled';
export type HouseholdRole = 'primary' | 'member';

export interface HouseholdRow {
  id: string;
  name: string;
  inviteCode: string;
  primaryUserId: string;
  subscriptionStatus: SubscriptionStatus;
  planId: string | null;
  stripeCustomerId: string | null;
  createdAt: Date;
}

interface RawHouseholdRow {
  id: string;
  name: string;
  invite_code: string;
  primary_user_id: string;
  subscription_status: SubscriptionStatus;
  plan_id: string | null;
  stripe_customer_id: string | null;
  created_at: Date;
}

const mapHouseholdRow = (row: RawHouseholdRow): HouseholdRow => ({
  id: row.id,
  name: row.name,
  inviteCode: row.invite_code,
  primaryUserId: row.primary_user_id,
  subscriptionStatus: row.subscription_status,
  planId: row.plan_id,
  stripeCustomerId: row.stripe_customer_id,
  createdAt: row.created_at,
});

export interface InsertHouseholdInput {
  name: string;
  inviteCode: string;
  primaryUserId: string;
}

/**
 * Inserts a `households` row. Callers are responsible for generating (and,
 * on a `23505` unique-violation against `households_invite_code_key`,
 * retrying with a fresh) `inviteCode` — this function does one insert
 * attempt only, so retry policy stays in the resolver, not buried here.
 */
export const insertHousehold = async (
  client: PoolClient,
  input: InsertHouseholdInput,
): Promise<HouseholdRow> => {
  const result = await client.query<RawHouseholdRow>(
    `INSERT INTO households (name, invite_code, primary_user_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.name, input.inviteCode, input.primaryUserId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertHousehold: expected a returned row.');
  }
  return mapHouseholdRow(row);
};

export interface MembershipRow {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
  joinedAt: Date;
}

interface RawMembershipRow {
  id: string;
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  joined_at: Date;
}

const mapMembershipRow = (row: RawMembershipRow): MembershipRow => ({
  id: row.id,
  householdId: row.household_id,
  userId: row.user_id,
  role: row.role,
  joinedAt: row.joined_at,
});

export interface InsertMembershipInput {
  householdId: string;
  userId: string;
  role: HouseholdRole;
}

/**
 * Inserts a `household_memberships` row. Must run before
 * `insertDefaultSettings` in the same transaction — `household_settings`'s
 * RLS policy requires a matching membership row to already exist for the
 * insert to be allowed (see `withUserTransaction.ts`'s and the migration's
 * own comments on this ordering).
 */
export const insertMembership = async (
  client: PoolClient,
  input: InsertMembershipInput,
): Promise<MembershipRow> => {
  const result = await client.query<RawMembershipRow>(
    `INSERT INTO household_memberships (household_id, user_id, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.householdId, input.userId, input.role],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertMembership: expected a returned row.');
  }
  return mapMembershipRow(row);
};

export interface SettingsRow {
  householdId: string;
  mealsEnabled: readonly string[];
  mealStructure: Record<string, unknown>;
  cuisineTier1: readonly string[];
  cuisineTier2Weights: Record<string, unknown>;
  dietaryTags: readonly string[];
  allergens: readonly string[];
  skipIngredients: readonly string[];
  updatedAt: Date;
}

interface RawSettingsRow {
  household_id: string;
  meals_enabled: string[];
  meal_structure: Record<string, unknown>;
  cuisine_tier1: string[];
  cuisine_tier2_weights: Record<string, unknown>;
  dietary_tags: string[];
  allergens: string[];
  skip_ingredients: string[];
  updated_at: Date;
}

const mapSettingsRow = (row: RawSettingsRow): SettingsRow => ({
  householdId: row.household_id,
  mealsEnabled: row.meals_enabled,
  mealStructure: row.meal_structure,
  cuisineTier1: row.cuisine_tier1,
  cuisineTier2Weights: row.cuisine_tier2_weights,
  dietaryTags: row.dietary_tags,
  allergens: row.allergens,
  skipIngredients: row.skip_ingredients,
  updatedAt: row.updated_at,
});

/**
 * Inserts a `household_settings` row using this codebase's own default
 * constants (`domain/householdDefaults.ts`) rather than relying on the DDL
 * column defaults alone — explicit here means a resolver can return the
 * settings it just wrote without a second SELECT, and any future drift
 * between the DDL default and this constant is caught by
 * `householdDefaults.test.ts`, not silently by a mismatched insert.
 */
export const insertDefaultSettings = async (
  client: PoolClient,
  householdId: string,
): Promise<SettingsRow> => {
  const result = await client.query<RawSettingsRow>(
    `INSERT INTO household_settings
       (household_id, meals_enabled, meal_structure, cuisine_tier1, cuisine_tier2_weights, dietary_tags, allergens, skip_ingredients)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      householdId,
      JSON.stringify(DEFAULT_MEALS_ENABLED),
      JSON.stringify(DEFAULT_MEAL_STRUCTURE),
      JSON.stringify(DEFAULT_CUISINE_TIER1),
      JSON.stringify(DEFAULT_CUISINE_TIER2_WEIGHTS),
      JSON.stringify(DEFAULT_DIETARY_TAGS),
      JSON.stringify(DEFAULT_ALLERGENS),
      JSON.stringify(DEFAULT_SKIP_INGREDIENTS),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertDefaultSettings: expected a returned row.');
  }
  return mapSettingsRow(row);
};

export interface MembershipWithHouseholdRow extends MembershipRow {
  household: HouseholdRow;
  settings: SettingsRow;
}

/**
 * Returns every `household_memberships` row for `userId`, joined to its
 * `households` and `household_settings` rows. Reading `household_settings`
 * requires this to run inside a `withUserTransaction(userId, ...)` scope
 * (its RLS policy requires `parimaan.user_id` to be set to a matching
 * member) — this function takes a `PoolClient` and never opens its own
 * transaction, so that scoping is entirely the caller's responsibility.
 */
export const findMembershipsForUser = async (
  client: PoolClient,
  userId: string,
): Promise<MembershipWithHouseholdRow[]> => {
  const result = await client.query<
    RawMembershipRow & { household: RawHouseholdRow; settings: RawSettingsRow }
  >(
    `SELECT
       m.id, m.household_id, m.user_id, m.role, m.joined_at,
       row_to_json(h.*) AS household,
       row_to_json(s.*) AS settings
     FROM household_memberships m
     JOIN households h ON h.id = m.household_id
     JOIN household_settings s ON s.household_id = m.household_id
     WHERE m.user_id = $1`,
    [userId],
  );

  return result.rows.map((row) => ({
    ...mapMembershipRow(row),
    household: mapHouseholdRow(row.household),
    settings: mapSettingsRow(row.settings),
  }));
};

/**
 * Looks up a single household by id. Plain `households` has no RLS policy
 * yet (per this slice's settled design — layer 2 resolver checks carry
 * authorization here, not layer 3 RLS), so this is a straightforward
 * lookup; still takes a `PoolClient` for consistency with the rest of this
 * repository and so it composes inside a `withUserTransaction` scope when a
 * caller also needs to touch `household_settings` in the same call.
 */
export const findHouseholdById = async (
  client: PoolClient,
  householdId: string,
): Promise<HouseholdRow | null> => {
  const result = await client.query<RawHouseholdRow>(`SELECT * FROM households WHERE id = $1`, [
    householdId,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : mapHouseholdRow(row);
};

/**
 * Replaces a household's `invite_code`, returning the updated row (or `null`
 * if no row matched `householdId` — the same null-not-throw convention as
 * `updateSettingsPartial`). Callers own the code generation and the
 * `23505`-on-`households_invite_code_key` retry policy (see
 * `domain/inviteCodeAttempts.ts`), exactly as `insertHousehold` does — this
 * function performs one update attempt and nothing else.
 *
 * SECURITY: `households` has NO RLS policy. Unlike `updateSettingsPartial`,
 * there is no layer-3 backstop here at all — the `WHERE id = $1` scope on
 * this statement plus the calling resolver's own `requireHouseholdMember`
 * gate are the ONLY protections. Calling this function without that gate in
 * front of it lets any caller rotate any household's invite code (see this
 * repository's own test proving exactly that). Enabling RLS on `households`
 * is deliberately out of scope for this slice: its policy would have to
 * permit `joinHousehold`'s `SELECT ... FOR UPDATE` on a household the caller
 * is (by definition) not yet a member of, which the obvious member-only
 * policy would break.
 */
export const updateInviteCode = async (
  client: PoolClient,
  householdId: string,
  inviteCode: string,
): Promise<HouseholdRow | null> => {
  const result = await client.query<RawHouseholdRow>(
    `UPDATE households SET invite_code = $2 WHERE id = $1 RETURNING *`,
    [householdId, inviteCode],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapHouseholdRow(row);
};

export interface FindHouseholdByInviteCodeOptions {
  /**
   * When `true`, appends `FOR UPDATE` — locks the matched `households` row
   * for the remainder of the enclosing transaction. This is `joinHousehold`'s
   * primary concurrency guard against the 5-member cap: two concurrent
   * transactions joining via the same invite code serialize on this lock,
   * so the second one's later cap check always sees the first one's
   * already-committed insert rather than a stale count. See
   * `resolvers/joinHousehold.ts` and `insertMembershipWithinCap` below.
   */
  forUpdate?: boolean;
}

export const findHouseholdByInviteCode = async (
  client: PoolClient,
  inviteCode: string,
  opts: FindHouseholdByInviteCodeOptions = {},
): Promise<HouseholdRow | null> => {
  const forUpdateClause = opts.forUpdate === true ? ' FOR UPDATE' : '';
  const result = await client.query<RawHouseholdRow>(
    `SELECT * FROM households WHERE invite_code = $1${forUpdateClause}`,
    [inviteCode],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapHouseholdRow(row);
};

/**
 * Looks up a single `household_memberships` row for `(householdId, userId)`,
 * or `null` if the caller isn't a member (or the household doesn't exist —
 * this function deliberately can't tell the two apart, which is exactly what
 * `auth/requireHouseholdMember.ts` relies on to avoid becoming a
 * household-existence oracle). Also used by `joinHousehold`'s idempotent
 * re-join pre-check.
 */
export const findMembership = async (
  client: PoolClient,
  householdId: string,
  userId: string,
): Promise<MembershipRow | null> => {
  const result = await client.query<RawMembershipRow>(
    `SELECT * FROM household_memberships WHERE household_id = $1 AND user_id = $2`,
    [householdId, userId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapMembershipRow(row);
};

/**
 * Conditionally inserts a `household_memberships` row only if the
 * household's current membership count is still below `cap` at the moment
 * this statement runs, via a single `INSERT ... SELECT ... WHERE` — not a
 * separate `SELECT count(*)` followed by an `INSERT`, which would leave a
 * check-then-act race window under READ COMMITTED. Returns `null` (not a
 * thrown error) when the cap was already reached, so callers can distinguish
 * "cap breach" from every other failure.
 *
 * This is defense-in-depth: `joinHousehold`'s `SELECT ... FOR UPDATE` row
 * lock on the household (see `findHouseholdByInviteCode`) is the primary
 * guard that makes the cap check race-free even under concurrent joins —
 * this conditional insert still holds even if that lock were ever removed.
 */
export const insertMembershipWithinCap = async (
  client: PoolClient,
  input: InsertMembershipInput,
  cap: number,
): Promise<MembershipRow | null> => {
  const result = await client.query<RawMembershipRow>(
    `INSERT INTO household_memberships (household_id, user_id, role)
     SELECT $1, $2, $3
     WHERE (SELECT count(*) FROM household_memberships WHERE household_id = $1) < $4
     RETURNING *`,
    [input.householdId, input.userId, input.role, cap],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapMembershipRow(row);
};

/**
 * Deletes the caller's own non-`primary` membership row, returning the
 * deleted row — or `null` if nothing matched, which covers three distinct
 * situations this function deliberately cannot tell apart: the user was never
 * a member, they already left, or they are the household's `primary` and the
 * `role <> 'primary'` predicate refused the delete. Callers that need to
 * distinguish those (to produce a `ForbiddenError` for the primary versus an
 * idempotent success for a non-member) must pre-check with `findMembership`
 * — this function is ONLY the guarded delete.
 *
 * SECURITY: this is the FIRST `DELETE` this codebase issues against
 * `household_memberships`, and that table has NO RLS policy. All three
 * predicates in the `WHERE` clause are load-bearing safety, not filtering
 * convenience, and there is no layer-3 backstop behind any of them:
 *   - `household_id = $1` scopes the delete to one household;
 *   - `user_id = $2` is the only thing stopping a caller from deleting
 *     someone else's membership (see this repository's own test proving a
 *     mismatched `user_id` deletes zero rows);
 *   - `role <> 'primary'` is the only thing stopping a household from
 *     becoming primary-less, which nothing downstream is built to handle.
 * Dropping any one of them is a privilege-escalation or data-integrity bug
 * that no other layer will catch.
 */
export const deleteNonPrimaryMembership = async (
  client: PoolClient,
  householdId: string,
  userId: string,
): Promise<MembershipRow | null> => {
  const result = await client.query<RawMembershipRow>(
    `DELETE FROM household_memberships
     WHERE household_id = $1 AND user_id = $2 AND role <> 'primary'
     RETURNING *`,
    [householdId, userId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapMembershipRow(row);
};

/**
 * Deletes a `households` row, returning it — or `null` if no row matched.
 * The dependent `household_memberships` and `household_settings` rows are
 * removed by Postgres itself: both tables FK-reference `households(id)` with
 * `ON DELETE CASCADE` (verified against `migrations/
 * 1787072268736_baseline-schema.ts`, not assumed), and referential-integrity
 * actions bypass row security, so the cascade reaches RLS-protected
 * `household_settings` too. No explicit child-row cleanup is needed here
 * today — but any FUTURE household-scoped table that does not declare
 * `ON DELETE CASCADE` must be deleted explicitly, before this call, in the
 * same transaction.
 *
 * SECURITY: same caveat as `updateInviteCode` — `households` has NO RLS
 * policy, so this statement's `WHERE id = $1` scope plus the calling
 * resolver's own primary-only `requireHouseholdMember` gate are the ONLY
 * protections against deleting an arbitrary household.
 */
export const deleteHousehold = async (
  client: PoolClient,
  householdId: string,
): Promise<HouseholdRow | null> => {
  const result = await client.query<RawHouseholdRow>(
    `DELETE FROM households WHERE id = $1 RETURNING *`,
    [householdId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapHouseholdRow(row);
};

/**
 * A partial patch for `household_settings` — every field optional, mirroring
 * `validation/updateHouseholdSettings.ts`'s `HouseholdSettingsInput` schema
 * exactly (absent field = "leave unchanged", never "clear this field"; that
 * distinction is enforced at the Zod boundary before it ever reaches here).
 */
export interface SettingsPatch {
  mealsEnabled?: readonly string[];
  mealStructure?: Record<string, unknown>;
  cuisineTier1?: readonly string[];
  cuisineTier2Weights?: Record<string, unknown>;
  dietaryTags?: readonly string[];
  allergens?: readonly string[];
  skipIngredients?: readonly string[];
}

/**
 * Applies `patch` to a single `household_settings` row via one `UPDATE ...
 * SET col = COALESCE($n::jsonb, col), ...` statement — an absent patch field
 * binds SQL `null`, and `COALESCE` keeps that column's existing value
 * unchanged, the same pattern `userRepository.ts`'s `upsertUserByCognitoSub`
 * already uses for its own optional fields. Returns `null` (not a thrown
 * error) if no row matched `householdId`, so callers can turn that into a
 * `NotFoundError` themselves.
 *
 * Subject to `household_settings`'s own RLS policy (member-only) — must run
 * inside a `withUserTransaction(userId, ...)` scope. `updateHouseholdSettings`
 * additionally gates on `requireHouseholdMember` *before* calling this as its
 * primary authorization layer; RLS here is defense-in-depth, not the only
 * check (see `repositories/householdRepository.test.ts`'s
 * `updateSettingsPartial` RLS-only regression test, which calls this function
 * directly, bypassing that resolver-level gate entirely).
 */
export const updateSettingsPartial = async (
  client: PoolClient,
  householdId: string,
  patch: SettingsPatch,
): Promise<SettingsRow | null> => {
  const toJsonParam = (value: unknown): string | null =>
    value === undefined ? null : JSON.stringify(value);

  const result = await client.query<RawSettingsRow>(
    `UPDATE household_settings SET
       meals_enabled = COALESCE($2::jsonb, meals_enabled),
       meal_structure = COALESCE($3::jsonb, meal_structure),
       cuisine_tier1 = COALESCE($4::jsonb, cuisine_tier1),
       cuisine_tier2_weights = COALESCE($5::jsonb, cuisine_tier2_weights),
       dietary_tags = COALESCE($6::jsonb, dietary_tags),
       allergens = COALESCE($7::jsonb, allergens),
       skip_ingredients = COALESCE($8::jsonb, skip_ingredients),
       updated_at = NOW()
     WHERE household_id = $1
     RETURNING *`,
    [
      householdId,
      toJsonParam(patch.mealsEnabled),
      toJsonParam(patch.mealStructure),
      toJsonParam(patch.cuisineTier1),
      toJsonParam(patch.cuisineTier2Weights),
      toJsonParam(patch.dietaryTags),
      toJsonParam(patch.allergens),
      toJsonParam(patch.skipIngredients),
    ],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapSettingsRow(row);
};

export const findSettingsForHousehold = async (
  client: PoolClient,
  householdId: string,
): Promise<SettingsRow | null> => {
  const result = await client.query<RawSettingsRow>(
    `SELECT * FROM household_settings WHERE household_id = $1`,
    [householdId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapSettingsRow(row);
};

interface RawUserRow {
  id: string;
  cognito_sub: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
}

/**
 * Mirrors `userRepository.ts`'s own (unexported) row mapper — duplicated
 * rather than imported because that module doesn't export its raw-row
 * mapping function, and this repository never opens its own connection to
 * `users` outside of a join like the one below.
 */
const mapUserRow = (row: RawUserRow): UserRow => ({
  id: row.id,
  cognitoSub: row.cognito_sub,
  email: row.email,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  createdAt: row.created_at,
});

export interface MembershipWithUserRow extends MembershipRow {
  user: UserRow;
}

/**
 * Returns every `household_memberships` row for `householdId`, joined to
 * each member's own `users` row — used to populate `Household.members` for
 * `joinHousehold`'s response, where (unlike `findMembershipsForUser`) the
 * caller needs N different members' `User`s, not just their own.
 */
export const findMembersForHousehold = async (
  client: PoolClient,
  householdId: string,
): Promise<MembershipWithUserRow[]> => {
  const result = await client.query<RawMembershipRow & { user: RawUserRow }>(
    `SELECT
       m.id, m.household_id, m.user_id, m.role, m.joined_at,
       row_to_json(u.*) AS user
     FROM household_memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.household_id = $1
     ORDER BY m.joined_at ASC`,
    [householdId],
  );

  return result.rows.map((row) => ({
    ...mapMembershipRow(row),
    user: mapUserRow(row.user),
  }));
};
