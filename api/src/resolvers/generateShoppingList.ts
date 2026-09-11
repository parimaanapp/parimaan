import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findMenuById, lockMenu } from '../repositories/menuRepository.js';
import { findShoppingListByMenu } from '../repositories/shoppingListRepository.js';
import { toGraphQLShoppingList } from '../mappers/shoppingList.js';
import type { GraphQLShoppingList } from '../mappers/shoppingList.js';
import { createFreshShoppingList } from './shoppingListGenerationPipeline.js';
import { generateShoppingListArgsSchema } from '../validation/shoppingList.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';
import { invokeStaplesNoteFn } from '../aiInvoke/staplesNoteInvoker.js';
import type { StaplesNoteInvokePayload } from '../aiInvoke/staplesNoteInvoker.js';

export interface GenerateShoppingListResolverDeps {
  getPool: () => Promise<Pool>;
  /**
   * Injectable seam over `invokeStaplesNoteFn` (W17 S3, D2) — defaults to
   * the real, best-effort-swallowing async Lambda invoke. Tests inject a
   * spy so this resolver's own tests can assert the invoke fires (or
   * doesn't) without a real AWS Lambda call — `aiInvoke/staplesNoteInvoker.test.ts`
   * covers the real implementation's own send/swallow behavior independently.
   */
  invokeStaplesNoteFn?: (payload: StaplesNoteInvokePayload) => Promise<void>;
}

export const productionDeps: GenerateShoppingListResolverDeps = { getPool, invokeStaplesNoteFn };

/**
 * Direct-Lambda resolver for `Mutation.generateShoppingList` (W11 S2,
 * E2E_MVP_PLAN.md §17.3). Resolves the household from `menuId` (SD §6.1's
 * locked single-argument signature) the same `findMenuById` + explicit
 * `requireHouseholdMember` pattern `addMenuItem`/`autoFillWeek` already
 * use — a nonexistent `menuId` and a real one in another household both
 * deny identically, never an existence oracle.
 *
 * Runs S1's pure pipeline (`aggregateIngredients` → `subtractPantry` →
 * `categorize`, via `computeFreshShoppingListItems`) against the menu's
 * CURRENT `menu_items` and the household's CURRENT pantry, then writes the
 * parent `shopping_lists` row and every generated `shopping_list_items` row
 * transactionally — a failure on the items half rolls back the parent
 * insert too. An empty menu (or one whose every ingredient is staple-
 * excluded) produces a list with zero items, never an error (S1's own
 * "empty menu generates an empty list" invariant).
 *
 * Refuses a second call while an OPEN list already exists for this exact
 * `menuId` (`findShoppingListByMenu`) — `regenerateShoppingList` (D8,
 * §17.2.8) is the only path that may write to an existing list, and its
 * merge-regenerate behavior would be silently bypassed if this mutation
 * were allowed to create a second, competing list for the same menu.
 */
export const createGenerateShoppingListHandler =
  (deps: GenerateShoppingListResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuId: unknown }>): Promise<GraphQLShoppingList> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = generateShoppingListArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    const result = await withUserTransaction(
      callerUser.id,
      async (client) => {
        const menu = await findMenuById(client, menuId);
        if (menu === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, menu.householdId);

        // Same menu-scoped advisory lock `addMenuItem`/`autoFillWeek` take,
        // acquired BEFORE the existence check below — without it, two
        // concurrent calls for the same menu could both observe "no open
        // list" and both insert one, silently violating the "at most one
        // open list per menu" invariant `findShoppingListByMenu`/
        // `regenerateShoppingList` both depend on (there is no DB-level
        // unique constraint backing it either). `regenerateShoppingList`
        // takes this identical lock, in the identical position, so the two
        // mutations serialize against each other too, not just against
        // themselves.
        await lockMenu(client, menuId);

        const existingOpenList = await findShoppingListByMenu(client, menuId);
        if (existingOpenList !== null) {
          throw new ConflictError(
            'A shopping list already exists for this menu. Use regenerateShoppingList to update it.',
          );
        }

        const { list, items } = await createFreshShoppingList(client, menu);

        return toGraphQLShoppingList(list, items);
      },
      pool,
    );

    // W17 S3 (D2, `E2E_MVP_PLAN.md` §23.2.2) — fired only AFTER
    // `withUserTransaction` above has resolved, i.e. only after a real
    // COMMIT. Never moved inside that callback: `InvocationType: 'Event'`
    // only guarantees the invoke is queued, not that `staplesNoteFn` won't
    // run before this transaction's own COMMIT lands, which — fired any
    // earlier — could let it read a state a concurrent rollback might still
    // undo. AWAITED here (not fire-and-forget) purely so the dispatching
    // `InvokeCommand` call itself actually leaves this execution environment
    // before Lambda freezes it post-response — `invokeStaplesNoteFn` itself
    // swallows every failure internally (never throws), so awaiting it adds
    // no latency risk to this resolver's own success/error path and never
    // changes its synchronous return value (`aiStaplesNote` stays `null`
    // here, per `mappers/shoppingList.ts`'s own hardcoding).
    const invoke = deps.invokeStaplesNoteFn ?? invokeStaplesNoteFn;
    await invoke({ listId: result.id, householdId: result.householdId });

    return result;
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createGenerateShoppingListHandler`'s returned function.
export const handler = withErrorHandling(createGenerateShoppingListHandler(productionDeps));
