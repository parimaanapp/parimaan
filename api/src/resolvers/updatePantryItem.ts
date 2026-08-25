import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { updatePantryItemPartial as updatePantryItemPartialRepo } from '../repositories/pantryRepository.js';
import type { PantryItemPatch } from '../repositories/pantryRepository.js';
import { canonicalizePantryCategory } from '../domain/pantryCategories.js';
import { canonicalizePantryUnit } from '../domain/pantryUnits.js';
import { toGraphQLPantryItem } from '../mappers/pantryItem.js';
import type { GraphQLPantryItem } from '../mappers/pantryItem.js';
import { updatePantryItemArgsSchema } from '../validation/updatePantryItem.js';
import type { PantryItemPatchInput } from '../validation/updatePantryItem.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * Zod's optional fields type as `T | undefined`, but `PantryItemPatch`
 * (under this repo's `exactOptionalPropertyTypes`) requires absent-not-set
 * — same strip-undefined-keys fix as `updateHouseholdSettings.ts`'s
 * `toSettingsPatch`. `unit`/`category` are canonicalised here (not inside
 * the strip), matching `addPantryItem.ts`'s ordering: after Zod validation
 * has already bounded shape/length, before the repository call.
 */
const toPantryItemPatch = (input: PantryItemPatchInput): PantryItemPatch => {
  const withCanonicalized: PantryItemPatchInput = {
    ...input,
    ...(input.unit !== undefined ? { unit: canonicalizePantryUnit(input.unit) } : {}),
    ...(input.category !== undefined ? { category: canonicalizePantryCategory(input.category) } : {}),
  };
  const entries = Object.entries(withCanonicalized).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as PantryItemPatch;
};

export interface UpdatePantryItemResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `updatePantryItemPartial`'s own signature, for forced-failure tests. */
  updatePantryItemPartial?: typeof updatePantryItemPartialRepo;
}

export const productionDeps: UpdatePantryItemResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.updatePantryItem`. Unlike every
 * other household-scoped resolver in this slice, there is no `householdId`
 * argument to gate on with `requireHouseholdMember` *before* touching the
 * database — `shared/schema.graphql`'s doc on this field explains why:
 * the item's household is discovered from `id` itself, via a query that is
 * already RLS-scoped to the caller's own households. A `null` result from
 * that query is therefore ambiguous by construction (nonexistent id, or a
 * real id in someone else's household) and is treated identically either
 * way — `NotFoundError`, never a separate "forbidden" signal that would
 * leak which case it was.
 */
export const createUpdatePantryItemHandler =
  (deps: UpdatePantryItemResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown; input: unknown }>): Promise<GraphQLPantryItem> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = updatePantryItemArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id, input } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const updatePantryItemPartial = deps.updatePantryItemPartial ?? updatePantryItemPartialRepo;
        const patch = toPantryItemPatch(input);
        const row = await updatePantryItemPartial(client, id, patch);
        if (row === null) {
          throw new NotFoundError('Pantry item not found.');
        }
        return toGraphQLPantryItem(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createUpdatePantryItemHandler`'s returned function.
export const handler = withErrorHandling(createUpdatePantryItemHandler(productionDeps));
