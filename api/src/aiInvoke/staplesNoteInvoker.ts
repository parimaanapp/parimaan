import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { z } from 'zod';

/**
 * `process.env` boundary for `staplesNoteFn`'s function name — same
 * fail-loudly-at-cold-start-of-the-CALL convention as `rateLimit/config.ts`'s
 * `loadCacheTableName`. Read lazily (inside {@link invokeStaplesNoteFn}, not
 * at module load) so a Lambda that never calls it (every resolver except
 * `generateShoppingList`/`regenerateShoppingList`) never pays a startup cost
 * for an env var it doesn't have.
 */
const envSchema = z.object({
  STAPLES_NOTE_FN_NAME: z.string().min(1, 'STAPLES_NOTE_FN_NAME must be set'),
});

export const loadStaplesNoteFnName = (env: Record<string, string | undefined> = process.env): string =>
  envSchema.parse(env).STAPLES_NOTE_FN_NAME;

export interface StaplesNoteInvokePayload {
  listId: string;
  householdId: string;
}

let memoizedLambdaClient: LambdaClient | undefined;
const getLambdaClient = (): LambdaClient => {
  memoizedLambdaClient ??= new LambdaClient({});
  return memoizedLambdaClient;
};

/**
 * Fires the one asynchronous `staplesNoteFn` invoke D2 locks
 * (`E2E_MVP_PLAN.md` §23.2.2) — `InvocationType: 'Event'`, called AFTER the
 * caller's own `withUserTransaction` scope has already committed. The
 * `Payload` is deliberately just `{ listId, householdId }`, never the full
 * menu/recipe data — `staplesNoteFn` re-reads fresh rather than trusting a
 * snapshot that could be stale by the time it actually runs.
 *
 * Deliberately swallows EVERY failure (a missing/misconfigured
 * `STAPLES_NOTE_FN_NAME` env var included) rather than letting it propagate
 * — `generateShoppingList`/`regenerateShoppingList`'s own synchronous return
 * value and latency must never depend on this call succeeding (PRD §7.1's
 * own "non-blocking, no writes" framing for this feature, D2's own explicit
 * requirement). Logged, not surfaced: there is no synchronous caller left to
 * show a failure to by the time this fires (identical reasoning to D7's own
 * "no synchronous caller left" framing for the rate limit inside
 * `staplesNoteFn` itself).
 */
export const invokeStaplesNoteFn = async (payload: StaplesNoteInvokePayload): Promise<void> => {
  try {
    const functionName = loadStaplesNoteFnName();
    await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (error) {
    console.error('Failed to fire staplesNoteFn async invoke', error);
  }
};
