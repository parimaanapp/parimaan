import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { geminiCookSuggestionsSchema } from '../ai/schemas/cookSuggestions.js';
import type { GeminiCookSuggestions } from '../ai/schemas/cookSuggestions.js';

/** 30 minutes (SD §8.6): long enough that a second look at the same pantry is free, short enough that a changed kitchen is not served stale. */
export const COOK_CACHE_TTL_SECONDS = 30 * 60;

/**
 * `cookFromPantry`'s row on `parimaan-cache-{env}` (W21 D5):
 * `PK = aiCache#cookFromPantry#{householdId}#{promptHash}`. The household id is
 * in the key, so there is no cross-household reuse even between two households
 * whose prompts happen to be identical, and a read can never return another
 * household's row. `promptHash` covers the whole rendered prompt plus the model
 * and sampling settings (`domain/promptHash.ts`), so a change to the pantry, the
 * vibe, the household's rules, the prompt version or the model is a different
 * key by construction.
 *
 * What is stored is the validated RAW model output, as a JSON string: grounding
 * and the household's rules are recomputed against the current state on every
 * read, so an alias-table fix or a rule change is never served stale.
 */
const buildKey = (householdId: string, promptHash: string): { PK: string; SK: string } => ({
  PK: `aiCache#cookFromPantry#${householdId}#${promptHash}`,
  SK: 'SUGGESTIONS',
});

/**
 * The cached model output, or `null` on a miss. A row that is missing, not a
 * string, not JSON, or no longer the right shape is treated exactly as a miss:
 * a malformed cache row is never worth failing the request over, and the
 * re-validation means a schema change cannot resurrect an old shape.
 */
export const getCachedCookSuggestions = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  householdId: string,
  promptHash: string,
): Promise<GeminiCookSuggestions | null> => {
  const result = await ddbClient.send(new GetCommand({ TableName: tableName, Key: buildKey(householdId, promptHash) }));
  const payload: unknown = result.Item?.['payload'];
  if (typeof payload !== 'string') {
    return null;
  }
  try {
    const parsed = geminiCookSuggestionsSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const putCachedCookSuggestions = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  householdId: string,
  promptHash: string,
  output: GeminiCookSuggestions,
  now: () => Date = () => new Date(),
): Promise<void> => {
  const ttl = Math.floor(now().getTime() / 1000) + COOK_CACHE_TTL_SECONDS;
  await ddbClient.send(new PutCommand({ TableName: tableName, Item: { ...buildKey(householdId, promptHash), payload: JSON.stringify(output), ttl } }));
};
