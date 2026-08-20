import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { updateSettingsPartial as updateSettingsPartialRepo } from '../repositories/householdRepository.js';
import type { SettingsPatch } from '../repositories/householdRepository.js';
import { toGraphQLSettings } from '../mappers/household.js';
import type { GraphQLSettings } from '../mappers/household.js';
import { updateHouseholdSettingsArgsSchema } from '../validation/updateHouseholdSettings.js';
import type { HouseholdSettingsInput } from '../validation/updateHouseholdSettings.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * Zod's optional fields are typed as `T | undefined`, but `SettingsPatch`
 * (under this repo's `exactOptionalPropertyTypes`) requires absent-not-set
 * rather than present-and-undefined — this strips any explicitly-`undefined`
 * keys so the object literal actually satisfies that stricter shape, rather
 * than casting past the compiler's own check.
 */
const toSettingsPatch = (input: HouseholdSettingsInput): SettingsPatch => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as SettingsPatch;
};

export interface UpdateHouseholdSettingsResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `updateSettingsPartial`'s own signature, for forced-failure/rollback tests. */
  updateSettingsPartial?: typeof updateSettingsPartialRepo;
}

export const productionDeps: UpdateHouseholdSettingsResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.updateHouseholdSettings`. Flow:
 * validate identity → validate `{ householdId, input }` (Zod, including the
 * "at least one field present" refinement) BEFORE touching the database,
 * matching `createHousehold`'s existing order → resolve/upsert the caller's
 * `users` row → within a single `withUserTransaction` scope:
 * `requireHouseholdMember` (the primary, layer-2 authorization gate — see
 * that module's own comment on why RLS alone isn't relied on here), then a
 * single partial `UPDATE` via `updateSettingsPartial`.
 */
export const createUpdateHouseholdSettingsHandler =
  (deps: UpdateHouseholdSettingsResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; input: unknown }>,
  ): Promise<GraphQLSettings> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = updateHouseholdSettingsArgsSchema.safeParse(event.arguments);
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

        const updateSettingsPartial = deps.updateSettingsPartial ?? updateSettingsPartialRepo;
        const patch = toSettingsPatch(input);
        const settings = await updateSettingsPartial(client, householdId, patch);
        if (settings === null) {
          // Shouldn't happen given requireHouseholdMember already confirmed
          // membership (and therefore the household's existence) above —
          // defensive, not a reachable-in-practice branch.
          throw new NotFoundError('Household settings not found.');
        }
        return toGraphQLSettings(settings);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createUpdateHouseholdSettingsHandler`'s returned function.
export const handler = withErrorHandling(createUpdateHouseholdSettingsHandler(productionDeps));
