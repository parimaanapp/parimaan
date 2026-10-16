import type { PoolClient } from 'pg';

const FOREIGN_KEY_VIOLATION = '23503';
const SAVEPOINT = 'ingredient_fk_fallback';

/** True for an FK violation on a household row's `ingredient_id` (a catalog entry that no longer exists). */
export const isIngredientFkViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === FOREIGN_KEY_VIOLATION && typeof constraint === 'string' && constraint.endsWith('ingredient_id_fkey');
};

/**
 * The module-cached catalog can be up to 10 minutes stale, so an ingredient
 * deleted by a deploy-time sync may still resolve to an id that no longer
 * exists. This runs `attempt(false)` inside a savepoint; on that specific FK
 * violation it rolls back to the savepoint (the outer transaction stays
 * usable) and runs `attempt(true)`, which must store the row with a null id
 * and null `catalog_match` ("not evaluated", so the backfill reconciles it).
 * Any other error propagates untouched. A save is never failed by a stale id.
 */
export const withIngredientFkFallback = async <T>(
  client: PoolClient,
  hasIngredientId: boolean,
  attempt: (dropIngredientId: boolean) => Promise<T>,
): Promise<T> => {
  if (!hasIngredientId) {
    return attempt(false);
  }
  await client.query(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const result = await attempt(false);
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return result;
  } catch (error: unknown) {
    if (!isIngredientFkViolation(error)) {
      throw error;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'ingredient_id_stale',
        message: 'Catalog id no longer exists (stale cache after a sync); saved without ingredient_id.',
      }),
    );
    return attempt(true);
  }
};
