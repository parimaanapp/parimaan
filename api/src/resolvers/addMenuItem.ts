import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  countMenuItemsInSlot,
  findMenuById,
  insertMenuItem as insertMenuItemRepo,
  lockMenu,
  lockMenuSlot,
} from '../repositories/menuRepository.js';
import { findRecipeById } from '../repositories/recipeRepository.js';
import type { RecipeRow } from '../repositories/recipeRepository.js';
import { findSettingsForHousehold } from '../repositories/householdRepository.js';
import { getMealSlotCap, isMealSlotEnabled, slotCountKeyRole } from '../domain/mealStructure.js';
import type { GraphQLMenuItem } from '../mappers/menu.js';
import { toGraphQLMenuItem } from '../mappers/menu.js';
import { addMenuItemArgsSchema } from '../validation/menu.js';
import type { MenuItemInput } from '../validation/menu.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * The mealsEnabled/cap/ownership checks addMenuItem must run server-side
 * (§15.3 S3 — see the handler's own doc), pulled out of the handler purely
 * to keep it under this codebase's max-lines-per-function lint rule.
 * Returns the already-fetched `RecipeRow` so the caller doesn't re-fetch it
 * to build the response.
 *
 * `lockMenu` runs first, then `lockMenuSlot`, both BEFORE
 * `countMenuItemsInSlot` — without them, two concurrent `addMenuItem`
 * calls for a slot sitting at `cap - 1` could both read the same pre-insert
 * count, both pass the check below, and both commit — overshooting the
 * cap, since `menu_items` has no DB constraint bounding the count per slot
 * (`migrations/1788100000000_menus.ts` only `CHECK`s individual column
 * values). The advisory locks serialize any second concurrent caller for
 * the identical slot until this transaction commits or rolls back, closing
 * that window — see `lockMenuSlot`'s own comment for why an advisory lock
 * rather than `SELECT ... FOR UPDATE` (there may be zero existing rows to
 * lock yet). The menu-scoped `lockMenu` (added W10, §16.2.6) is acquired
 * FIRST, in the identical order `autoFillWeek`'s own commit acquires it —
 * without matching lock ORDER across both code paths, a concurrent
 * `addMenuItem` and `autoFillWeek` commit could each hold one lock the
 * other wants and deadlock, rather than one simply waiting for the other.
 */
const validateAddMenuItem = async (
  client: PoolClient,
  householdId: string,
  menuId: string,
  input: MenuItemInput,
): Promise<RecipeRow> => {
  await lockMenu(client, menuId);

  const [settings, recipe] = await Promise.all([
    findSettingsForHousehold(client, householdId),
    findRecipeById(client, input.recipeId),
  ]);
  if (settings === null) {
    throw new Error(`addMenuItem: household ${householdId} has no settings row.`);
  }
  if (!isMealSlotEnabled(settings.mealsEnabled, input.mealSlot)) {
    throw new ConflictError('This meal is not enabled for this household.');
  }
  if (recipe === null || recipe.householdId !== householdId) {
    throw new NotFoundError('Recipe not found.');
  }

  // Single-item slots (breakfast/snacks) cap the WHOLE slot at 1, regardless
  // of role — locked/counted with slotRole:null so any existing item in
  // that slot counts, not just one matching this role.
  const countBySlotRole = slotCountKeyRole(input.mealSlot, input.slotRole);
  await lockMenuSlot(client, menuId, input.dayOfWeek, input.mealSlot, countBySlotRole);

  const cap = getMealSlotCap(settings.mealStructure, input.mealSlot, input.slotRole);
  const currentCount = await countMenuItemsInSlot(client, menuId, input.dayOfWeek, input.mealSlot, countBySlotRole);
  if (currentCount >= cap) {
    throw new ConflictError('This meal slot is full.');
  }

  return recipe;
};

export interface AddMenuItemResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: AddMenuItemResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.addMenuItem`. There is no
 * `householdId` argument (SD §6.1's locked signature is `(menuId, input)`),
 * so the household to gate against is resolved from `menuId` itself via
 * `findMenuById` — RLS-scoped, so a `menuId` in another household comes
 * back `null` identical to a genuinely nonexistent one, and both throw the
 * byte-identical `requireHouseholdMember` denial rather than a distinct
 * "menu not found" message (no existence oracle, same property every other
 * household-scoped resolver has).
 *
 * Enforces two business rules server-side, not just in the mobile client
 * (E2E_MVP_PLAN.md §15.3 S3 — client validation is presentation-only, the
 * server is the source of truth):
 *  1. `mealSlot` must be one of the household's `mealsEnabled` — a household
 *     that hasn't enabled Snacks can't have a snack placed on its menu at
 *     all, regardless of cap.
 *  2. The `(dayOfWeek, mealSlot, slotRole)` triple must be under its
 *     configured cap — 1 for `breakfast`/`snacks` (single-recipe meals, no
 *     per-role structure), or `mealStructure[mealSlot][slotRole]` for
 *     `lunch`/`dinner` (`domain/mealStructure.ts`).
 *
 * Also verifies `recipeId` belongs to the SAME household as `menuId` — RLS
 * on `recipes` only proves the caller belongs to *some* household containing
 * that recipe, not that it's *this* one, which matters for a caller who
 * belongs to multiple households. The `menu_items.recipe_id` FK doesn't
 * enforce this either (FK checks don't run through RLS), so this explicit
 * equality check is the only thing that does.
 */
export const createAddMenuItemHandler =
  (deps: AddMenuItemResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ menuId: unknown; input: unknown }>,
  ): Promise<GraphQLMenuItem> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = addMenuItemArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId, input } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const menu = await findMenuById(client, menuId);
        if (menu === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, menu.householdId);

        const recipe = await validateAddMenuItem(client, menu.householdId, menuId, input);

        const inserted = await insertMenuItemRepo(client, {
          menuId,
          recipeId: input.recipeId,
          dayOfWeek: input.dayOfWeek,
          mealSlot: input.mealSlot,
          slotRole: input.slotRole,
          servingsOverride: input.servingsOverride ?? null,
        });

        return toGraphQLMenuItem({
          id: inserted.id,
          menuId: inserted.menuId,
          recipe,
          dayOfWeek: inserted.dayOfWeek,
          mealSlot: inserted.mealSlot,
          slotRole: inserted.slotRole,
          servingsOverride: inserted.servingsOverride,
          madeAt: inserted.madeAt,
        });
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createAddMenuItemHandler`'s returned function.
export const handler = withErrorHandling(createAddMenuItemHandler(productionDeps));
