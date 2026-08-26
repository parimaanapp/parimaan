import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { insertPantryItem } from '../repositories/pantryRepository.js';
import { canonicalizePantryCategory } from '../domain/pantryCategories.js';
import { canonicalizePantryUnit } from '../domain/pantryUnits.js';
import { toGraphQLPantryItem } from '../mappers/pantryItem.js';
import type { GraphQLPantryItem } from '../mappers/pantryItem.js';
import { addPantryItemArgsSchema } from '../validation/addPantryItem.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface AddPantryItemResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: AddPantryItemResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.addPantryItem`. Flow matches
 * `updateHouseholdSettings.ts`: validate identity → validate
 * `{ householdId, input }` → resolve caller → `requireHouseholdMember`
 * inside a single `withUserTransaction` scope → insert.
 *
 * `addedBy` is taken exclusively from `callerUser.id` (the verified,
 * server-resolved identity) — `PantryItemInput` has no `addedBy` field in
 * the SDL at all, so there is no client-supplied value to even
 * accidentally trust. `unit`/`category` are canonicalised
 * (E2E_MVP_PLAN.md §11.2.4) right before the insert, after Zod validation
 * has already bounded their shape/length — canonicalisation is a
 * normalisation step, not a validation one, so it runs after validation
 * succeeds rather than inside the Zod schema itself.
 */
export const createAddPantryItemHandler =
  (deps: AddPantryItemResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; input: unknown }>,
  ): Promise<GraphQLPantryItem> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = addPantryItemArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, input } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const row = await insertPantryItem(client, {
          householdId,
          name: input.name,
          quantity: input.quantity,
          unit: canonicalizePantryUnit(input.unit),
          category: input.category == null ? null : canonicalizePantryCategory(input.category),
          isStaple: input.isStaple ?? false,
          expiryDate: input.expiryDate ?? null,
          lowThreshold: input.lowThreshold ?? null,
          addedBy: callerUser.id,
        });
        return toGraphQLPantryItem(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createAddPantryItemHandler`'s returned function.
export const handler = withErrorHandling(createAddPantryItemHandler(productionDeps));
