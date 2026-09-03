import type { PoolClient } from 'pg';
import { toAwsDateString } from '../domain/pgDate.js';
import { canonicalizePantryUnit } from '../domain/pantryUnits.js';
import { convertQuantity } from '../domain/unitConversion.js';
import { namesMatch, normalizeIngredientName, unitsCompatible } from '../domain/shoppingListGeneration.js';

export interface PantryItemRow {
  id: string;
  householdId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  isStaple: boolean;
  /** `YYYY-MM-DD`, or `null` — see `shared/schema.graphql`'s `PantryItem.expiryDate` doc. */
  expiryDate: string | null;
  lowThreshold: number | null;
  addedBy: string;
  addedAt: Date;
  updatedAt: Date;
}

interface RawPantryItemRow {
  id: string;
  household_id: string;
  name: string;
  // `NUMERIC` columns come back from `pg` as strings (its default type
  // parser avoids silent float-precision loss) — converted to `number` here
  // since the GraphQL side is `Float`, not a decimal-safe string scalar.
  quantity: string;
  unit: string;
  category: string | null;
  is_staple: boolean;
  expiry_date: Date | null;
  low_threshold: string | null;
  added_by: string;
  added_at: Date;
  updated_at: Date;
}

const mapPantryItemRow = (row: RawPantryItemRow): PantryItemRow => ({
  id: row.id,
  householdId: row.household_id,
  name: row.name,
  quantity: Number(row.quantity),
  unit: row.unit,
  category: row.category,
  isStaple: row.is_staple,
  expiryDate: row.expiry_date === null ? null : toAwsDateString(row.expiry_date),
  lowThreshold: row.low_threshold === null ? null : Number(row.low_threshold),
  addedBy: row.added_by,
  addedAt: row.added_at,
  updatedAt: row.updated_at,
});

export interface InsertPantryItemInput {
  householdId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  isStaple: boolean;
  expiryDate: string | null;
  lowThreshold: number | null;
  addedBy: string;
}

export const insertPantryItem = async (
  client: PoolClient,
  input: InsertPantryItemInput,
): Promise<PantryItemRow> => {
  const result = await client.query<RawPantryItemRow>(
    `INSERT INTO pantry_items
       (household_id, name, quantity, unit, category, is_staple, expiry_date, low_threshold, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.householdId,
      input.name,
      input.quantity,
      input.unit,
      input.category,
      input.isStaple,
      input.expiryDate,
      input.lowThreshold,
      input.addedBy,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertPantryItem: expected a returned row.');
  }
  return mapPantryItemRow(row);
};

export interface FindPantryItemsFilter {
  /** Case-insensitive substring match against `name`. Absent = no filter. */
  search?: string;
  /** Exact match against `category`. Absent = no filter. */
  category?: string;
}

/**
 * Both filters are applied as bind parameters, never string-concatenated
 * into the SQL text — that is what makes this injection-proof, not any
 * escaping logic. A `search` value like `%' OR '1'='1` is bound as a plain
 * string value inside the `LIKE` pattern and matched literally; it cannot
 * break out of the parameter into the surrounding SQL.
 *
 * Uses `idx_pantry_household_name (household_id, LOWER(name))` for the
 * `household_id` equality at minimum; a leading-wildcard `LIKE` can't use a
 * B-tree index for the substring part itself, which is an accepted
 * trade-off for the pantry sizes this MVP deals with (dozens of items per
 * household, not thousands).
 */
export const findPantryItems = async (
  client: PoolClient,
  householdId: string,
  filter: FindPantryItemsFilter = {},
): Promise<PantryItemRow[]> => {
  const result = await client.query<RawPantryItemRow>(
    `SELECT * FROM pantry_items
     WHERE household_id = $1
       AND ($2::text IS NULL OR LOWER(name) LIKE '%' || LOWER($2) || '%')
       AND ($3::text IS NULL OR category = $3)
     ORDER BY LOWER(name)`,
    [householdId, filter.search ?? null, filter.category ?? null],
  );
  return result.rows.map(mapPantryItemRow);
};

/**
 * Looks up a single pantry item by id, with no `householdId` to check
 * against — `updatePantryItem`/`deletePantryItem` take only `id` (see
 * `shared/schema.graphql`'s doc on both), so there is no client-supplied
 * household context to gate on *before* this query the way
 * `requireHouseholdMember` does for every other household-scoped resolver.
 * RLS is therefore the only thing standing between a caller and an item
 * belonging to someone else's household here — a non-member's query for a
 * real item in another household returns `null`, indistinguishable from
 * the item simply not existing (see `resolvers/updatePantryItem.ts`'s doc
 * for how that collapses into one denial response).
 */
export const findPantryItemById = async (
  client: PoolClient,
  id: string,
): Promise<PantryItemRow | null> => {
  const result = await client.query<RawPantryItemRow>(`SELECT * FROM pantry_items WHERE id = $1`, [
    id,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : mapPantryItemRow(row);
};

export interface HaveItPantryUpsertInput {
  householdId: string;
  /**
   * The shopping-list item's own name — matched fuzzily (D2) against this
   * household's existing pantry rows. No length bound is enforced here:
   * every CURRENT writer of `shopping_list_items.name` (`generateShoppingList`
   * / `regenerateShoppingList`, sourced from `recipe_ingredients.name`) is
   * already bounded to `MAX_INGREDIENT_NAME_LENGTH` at the point of original
   * insertion (`validation/recipeShared.ts`), so this is safe today. A
   * future `addShoppingListItem` (not built this week) that lets a client
   * write `shopping_list_items.name`/`unit` directly should apply the same
   * bound at ITS OWN validation boundary — this function trusts its input
   * the same way `insertPantryItem` already does, it does not re-validate.
   */
  name: string;
  /** The caller-confirmed quantity (`haveIt`'s `quantity` argument, already validated strictly positive). */
  quantity: number;
  /** The shopping-list item's own unit — `null` (an unparsed/free-text quantity) never matches an existing row's non-null unit, matching D3's own "either side null and they differ" fallback in `shoppingListGeneration.ts`'s `unitsCompatible`. */
  unit: string | null;
  addedBy: string;
}

/**
 * The "no match" (or defensively, "matched but somehow unconvertible")
 * branch of {@link upsertOrIncrementPantryItemForHaveIt} — extracted so
 * that function stays under this repo's `max-lines-per-function` ceiling
 * without duplicating the same `insertPantryItem` call inline twice.
 */
const insertFreshPantryItemForHaveIt = (
  client: PoolClient,
  input: HaveItPantryUpsertInput,
): Promise<PantryItemRow> =>
  insertPantryItem(client, {
    householdId: input.householdId,
    name: input.name,
    quantity: input.quantity,
    // `pantry_items.unit` is `NOT NULL` — a shopping-list item with no
    // parsed unit (free-text quantity, e.g. "to taste") falls back to an
    // empty string rather than failing the whole have-it write; this
    // mirrors the "unrecognised unit stays exact-match-only" fallback D3
    // already accepts, just at the empty-string edge of it.
    unit: input.unit ?? '',
    category: null,
    isStaple: false,
    expiryDate: null,
    lowThreshold: null,
    addedBy: input.addedBy,
  });

/**
 * Serializes concurrent `haveIt` calls for the same household around
 * {@link upsertOrIncrementPantryItemForHaveIt}'s own read-then-decide-write
 * sequence — a transaction-scoped advisory lock (auto-released at
 * COMMIT/ROLLBACK, `pg_advisory_xact_lock`, never needs an explicit unlock),
 * same shape and reasoning as `menuRepository.ts`'s `lockMenu`: a plain
 * `SELECT ... FOR UPDATE` can't be used here because there may be ZERO
 * existing rows to lock yet (the "no match, insert a fresh row" branch).
 * Without this, two concurrent `haveIt` calls for the same household could
 * both read `findPantryItems` before either commits and either (a) both
 * see "no match" and both insert a separate row for the same ingredient, or
 * (b) both see the same existing row's quantity and both `UPDATE` with a
 * value computed from that same stale read — whichever commits second
 * silently overwrites, rather than adds to, the first's increment. Call
 * this BEFORE `findPantryItems` in {@link upsertOrIncrementPantryItemForHaveIt},
 * never after.
 */
export const lockPantryForHousehold = async (client: PoolClient, householdId: string): Promise<void> => {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`pantry:${householdId}`]);
};

/**
 * `haveIt`'s (W11 S3, E2E_MVP_PLAN.md §17.3, SD §5.7) upsert-or-increment
 * into `pantry_items` — D2's fuzzy name match (`namesMatch`,
 * `INGREDIENT_SIMILARITY_THRESHOLD`) combined with D3's unit-conversion-
 * aware compatibility (`unitsCompatible`/`convertQuantity`), REUSING
 * `domain/shoppingListGeneration.ts`'s own matcher rather than a second,
 * drift-prone reimplementation of the same rule `subtractPantry` already
 * applies on the read side. A match increments that row's `quantity` —
 * the confirmed amount converted into the EXISTING row's own unit, so an
 * existing row's unit is never silently rewritten by a same-family cross-
 * unit have-it. No match (genuinely different ingredient, or a cross-
 * family/unrecognised-unit pair) inserts a brand-new row at the confirmed
 * quantity/unit instead of incorrectly summing into an unrelated one
 * (§17.5.3's own accepted, narrower correctness cost).
 *
 * Reads the WHOLE household pantry (`findPantryItems`, unfiltered) rather
 * than a targeted query — same "dozens of items per household, not
 * thousands" trade-off `findPantryItems`'s own doc already accepts for its
 * `LIKE` substring search, and the only way to run D2's fuzzy match at all
 * (it can't be pushed into a `WHERE` clause).
 */
export const upsertOrIncrementPantryItemForHaveIt = async (
  client: PoolClient,
  input: HaveItPantryUpsertInput,
): Promise<PantryItemRow> => {
  // MUST precede `findPantryItems` below — see `lockPantryForHousehold`'s
  // own doc for the exact race this closes.
  await lockPantryForHousehold(client, input.householdId);
  const existingItems = await findPantryItems(client, input.householdId);
  const normalizedIncomingName = normalizeIngredientName(input.name);
  const canonicalIncomingUnit = input.unit === null ? null : canonicalizePantryUnit(input.unit);

  const match = existingItems.find((item) => {
    const canonicalExistingUnit = canonicalizePantryUnit(item.unit);
    return (
      namesMatch(normalizeIngredientName(item.name), normalizedIncomingName) &&
      unitsCompatible(canonicalExistingUnit, canonicalIncomingUnit)
    );
  });

  if (match === undefined) {
    return insertFreshPantryItemForHaveIt(client, input);
  }

  const canonicalExistingUnit = canonicalizePantryUnit(match.unit);
  // The `?? ''` fallback below is unreachable in practice: `unitsCompatible`
  // (the gate `match` was found through) only ever returns `true` for a
  // `null` `canonicalIncomingUnit` when `canonicalExistingUnit` is ALSO
  // `null` — but that case is caught by the `canonicalExistingUnit ===
  // canonicalIncomingUnit` branch just above, never reaching this call.
  // Kept only so `convertQuantity`'s `string` parameter type is satisfied
  // without an unsafe cast.
  const convertedIncoming =
    canonicalExistingUnit === canonicalIncomingUnit
      ? input.quantity
      : convertQuantity(input.quantity, canonicalIncomingUnit ?? '', canonicalExistingUnit);

  // Defensive only — `unitsCompatible` already guaranteed convertibility
  // to reach this branch, so `convertedIncoming` should never be `null`
  // here; if some future edit to either function ever makes that not
  // hold, fail safe by creating a fresh row rather than writing a `NaN`
  // quantity into an existing one.
  if (convertedIncoming === null) {
    return insertFreshPantryItemForHaveIt(client, input);
  }

  const updated = await updatePantryItemPartial(client, match.id, {
    quantity: match.quantity + convertedIncoming,
  });
  if (updated === null) {
    // Unreachable against real data under `withUserTransaction`'s single
    // connection (nothing else can delete `match` between the read above
    // and this write within the same transaction) — a defensive throw
    // rather than a silent `undefined`, matching this file's other
    // `expected a returned row` guards.
    throw new Error('upsertOrIncrementPantryItemForHaveIt: matched row vanished mid-transaction.');
  }
  return updated;
};

export interface PantryItemPatch {
  name?: string;
  quantity?: number;
  unit?: string;
  category?: string;
  isStaple?: boolean;
  /** `YYYY-MM-DD`. */
  expiryDate?: string;
  lowThreshold?: number;
}

/**
 * Applies `patch` to a single `pantry_items` row via one `UPDATE ... SET
 * col = COALESCE($n, col), ...` statement — identical pattern to
 * `householdRepository.ts`'s `updateSettingsPartial`: an absent patch field
 * binds SQL `null`, and `COALESCE` keeps that column's existing value
 * unchanged. Returns `null` if no row matched `id` — either it doesn't
 * exist, or (via RLS's `USING` clause) it belongs to a household the caller
 * isn't a member of; see `findPantryItemById`'s doc for why those two cases
 * are indistinguishable by design here.
 */
export const updatePantryItemPartial = async (
  client: PoolClient,
  id: string,
  patch: PantryItemPatch,
): Promise<PantryItemRow | null> => {
  const result = await client.query<RawPantryItemRow>(
    `UPDATE pantry_items SET
       name = COALESCE($2::text, name),
       quantity = COALESCE($3::numeric, quantity),
       unit = COALESCE($4::text, unit),
       category = COALESCE($5::text, category),
       is_staple = COALESCE($6::boolean, is_staple),
       expiry_date = COALESCE($7::date, expiry_date),
       low_threshold = COALESCE($8::numeric, low_threshold),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.quantity ?? null,
      patch.unit ?? null,
      patch.category ?? null,
      patch.isStaple ?? null,
      patch.expiryDate ?? null,
      patch.lowThreshold ?? null,
    ],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapPantryItemRow(row);
};

/**
 * Deletes a single pantry item by id and returns the row that was deleted
 * (`null` if none matched — same indistinguishable not-found-vs-not-mine
 * reasoning as `findPantryItemById`). Returning the deleted row rather than
 * a boolean is what lets `Mutation.deletePantryItem` report `PantryItem!`
 * instead of `Boolean!` (§11.2.1) — a future `onPantryChanged` subscriber
 * needs to know *which* item vanished, not just that a delete happened
 * somewhere.
 */
export const deletePantryItemById = async (
  client: PoolClient,
  id: string,
): Promise<PantryItemRow | null> => {
  const result = await client.query<RawPantryItemRow>(
    `DELETE FROM pantry_items WHERE id = $1 RETURNING *`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapPantryItemRow(row);
};
