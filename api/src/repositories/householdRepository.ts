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
