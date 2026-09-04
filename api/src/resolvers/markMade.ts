import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findMenuItemForMarkMade, setMenuItemMadeAt as setMenuItemMadeAtRepo } from '../repositories/menuRepository.js';
import { findRecipeById, findRecipeIngredientsByRecipeId } from '../repositories/recipeRepository.js';
import type { RecipeRow } from '../repositories/recipeRepository.js';
import {
  applyDeductionLines as applyDeductionLinesRepo,
  findPantryItems,
  lockPantryForHousehold,
} from '../repositories/pantryRepository.js';
import type { PantryItemRow } from '../repositories/pantryRepository.js';
import { computeDeductionLines } from '../domain/pantryDeduction.js';
import type { DeductionLine } from '../domain/pantryDeduction.js';
import { toGraphQLMenuItem } from '../mappers/menu.js';
import type { GraphQLMenuItem } from '../mappers/menu.js';
import { markMadeArgsSchema } from '../validation/menu.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * The membership-check + read-only half of `markMade` (household
 * resolution, the recipe/ingredients/pantry reads, and S1's pure
 * `computeDeductionLines`), pulled out of the handler purely to keep it
 * under this codebase's `max-lines-per-function` lint rule — the same
 * reason `addMenuItem.ts`'s own `validateAddMenuItem` was extracted.
 * Returns the already-fetched `RecipeRow` so the caller doesn't re-fetch it
 * to build the response, mirroring `validateAddMenuItem`'s identical
 * "return what the caller needs next" shape.
 *
 * `lockPantryForHousehold` MUST precede `findPantryItems` — see that
 * function's own doc for the exact concurrent-double-decrement race this
 * closes, the identical one `upsertOrIncrementPantryItemForHaveIt` already
 * guards for `haveIt`.
 */
const loadMarkMadeDeduction = async (
  client: PoolClient,
  callerUserId: string,
  menuItemId: string,
): Promise<{
  householdId: string;
  recipe: RecipeRow;
  pantryItemsBeforeDeduction: PantryItemRow[];
  deductionLines: DeductionLine[];
}> => {
  const found = await findMenuItemForMarkMade(client, menuItemId);
  if (found === null) {
    throw new ForbiddenError(DENIAL_MESSAGE);
  }
  await requireHouseholdMember(client, callerUserId, found.householdId);

  const recipe = await findRecipeById(client, found.recipeId);
  if (recipe === null) {
    // Unreachable against real data — `found.recipeId` is a live FK into
    // `recipes`, read moments earlier in this same transaction — but a
    // defensive throw rather than an unsafe non-null assertion, matching
    // `haveIt.ts`'s own "shopping list vanished" guard.
    throw new Error('markMade: recipe vanished mid-transaction.');
  }
  const ingredients = await findRecipeIngredientsByRecipeId(client, found.recipeId);

  await lockPantryForHousehold(client, found.householdId);
  const pantryItemsBeforeDeduction = await findPantryItems(client, found.householdId);

  const deductionLines = computeDeductionLines(
    { servings: recipe.servings, ingredients },
    found.servingsOverride,
    pantryItemsBeforeDeduction,
  );

  return { householdId: found.householdId, recipe, pantryItemsBeforeDeduction, deductionLines };
};

export interface MarkMadeResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `applyDeductionLines`'s own signature, for forced-failure atomicity tests. */
  applyDeductionLines?: typeof applyDeductionLinesRepo;
  /** Injectable seam matching `setMenuItemMadeAt`'s own signature, for forced-failure atomicity tests. */
  setMenuItemMadeAt?: typeof setMenuItemMadeAtRepo;
}

export const productionDeps: MarkMadeResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.markMade` (W12 S2, E2E_MVP_PLAN.md
 * §18.3 S2; SD §6.1's already-locked shape — zero widening). Resolves the
 * item's household the same id-only-then-RLS-scoped pattern `addMenuItem`'s
 * own doc establishes — `menu_items` has no `householdId` argument, so
 * `findMenuItemForMarkMade` discovers it by joining out to the item's
 * parent `menus` row (itself RLS-scoped), in the same round trip that also
 * returns `recipeId`/`servingsOverride`, everything `computeDeductionLines`
 * needs. A `null` result (nonexistent `menuItemId`, or a real one in
 * another household) throws the SAME `ForbiddenError`/`DENIAL_MESSAGE`
 * every other id-only resolver in this codebase uses — never an existence
 * oracle. `requireHouseholdMember` is then called explicitly with the
 * discovered `householdId` as a second, defense-in-depth gate on top of
 * RLS, the same belt-and-suspenders shape `addMenuItem`/`haveIt` use after
 * their own id-lookup.
 *
 * Reads (before any write): the recipe (for `servings`, D2's scaling
 * denominator) and its ingredients, then locks and reads the household's
 * whole pantry (`lockPantryForHousehold` MUST precede `findPantryItems` —
 * see that function's own doc for the exact concurrent-double-decrement
 * race this closes, the identical one `upsertOrIncrementPantryItemForHaveIt`
 * already guards for `haveIt`). `computeDeductionLines` (S1, pure) then
 * decides every line from that single consistent snapshot.
 *
 * Writes, in one transaction (`withUserTransaction` — a throw anywhere
 * below rolls back everything already written this call):
 *   1. `applyDeductionLines` — the write half of S1's pure computation,
 *      already staple-filtered (O2) and zero-floored (O1).
 *   2. `setMenuItemMadeAt` — stamps `made_at`, guarded by
 *      `WHERE made_at IS NULL` so a second `markMade` call on the same item
 *      returns `null` here (never a silent double deduction) — mapped to a
 *      `CONFLICT`, which rolls back step 1's pantry writes too via the same
 *      transaction, mirroring `haveIt`'s own already-purchased guard shape
 *      exactly.
 *
 * Returns the updated `MenuItem!` (SD's own already-locked return type,
 * zero widening) — NOT attached to any subscription this week (D4,
 * §18.2.4): the directly-consumed return shape isn't worth widening,
 * the identical structural call W11's D9-carryover already made for
 * `addMenuItem`/`removeMenuItem`/`autoFillWeek`.
 */
export const createMarkMadeHandler =
  (deps: MarkMadeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuItemId: unknown }>): Promise<GraphQLMenuItem> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = markMadeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuItemId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const { recipe, pantryItemsBeforeDeduction, deductionLines } = await loadMarkMadeDeduction(
          client,
          callerUser.id,
          menuItemId,
        );

        const applyDeductionLines = deps.applyDeductionLines ?? applyDeductionLinesRepo;
        await applyDeductionLines(client, pantryItemsBeforeDeduction, deductionLines);

        const setMenuItemMadeAt = deps.setMenuItemMadeAt ?? setMenuItemMadeAtRepo;
        const updated = await setMenuItemMadeAt(client, menuItemId);
        if (updated === null) {
          throw new ConflictError('This menu item has already been marked as made.');
        }

        return toGraphQLMenuItem({
          id: updated.id,
          menuId: updated.menuId,
          recipe,
          dayOfWeek: updated.dayOfWeek,
          mealSlot: updated.mealSlot,
          slotRole: updated.slotRole,
          servingsOverride: updated.servingsOverride,
          madeAt: updated.madeAt,
        });
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createMarkMadeHandler`'s returned function.
export const handler = withErrorHandling(createMarkMadeHandler(productionDeps));
