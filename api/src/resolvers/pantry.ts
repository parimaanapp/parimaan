import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findPantryItems } from '../repositories/pantryRepository.js';
import { toGraphQLPantryItem } from '../mappers/pantryItem.js';
import type { GraphQLPantryItem } from '../mappers/pantryItem.js';
import { pantryArgsSchema } from '../validation/pantry.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface PantryResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: PantryResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.pantry`. Flow matches `household.ts`:
 * validate identity → validate `{ householdId, search?, category? }` →
 * resolve caller → `requireHouseholdMember` (layer 2) inside a single
 * `withUserTransaction` scope, with `pantry_items`' `FOR ALL USING (...)
 * WITH CHECK (...)` policy as layer-3 defense-in-depth behind it → filtered
 * read. Denies a non-member identically to a nonexistent `householdId`,
 * same existence-oracle-avoidance as every other household-scoped resolver.
 */
export const createPantryHandler =
  (deps: PantryResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; search: unknown; category: unknown }>,
  ): Promise<GraphQLPantryItem[]> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = pantryArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, search, category } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        // `exactOptionalPropertyTypes` means `{ search, category }` (both
        // possibly `undefined`) doesn't satisfy `FindPantryItemsFilter`'s
        // optional properties directly — same "strip explicit undefined
        // keys" fix as `updateHouseholdSettings.ts`'s `toSettingsPatch`.
        // `!= null` (loose), not `!== undefined`: `pantryArgsSchema`'s
        // `.nullish()` means an unset filter can parse to either `undefined`
        // (key absent) or `null` (key present, explicit null — what a Ferry
        // client actually sends on the wire for an unset nullable variable),
        // and both must mean "no filter" here.
        const filter: { search?: string; category?: string } = {};
        if (search != null) {
          filter.search = search;
        }
        if (category != null) {
          filter.category = category;
        }

        const rows = await findPantryItems(client, householdId, filter);
        return rows.map(toGraphQLPantryItem);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createPantryHandler`'s returned function.
export const handler = withErrorHandling(createPantryHandler(productionDeps));
