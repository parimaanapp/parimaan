import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** 24 hours, per D6 (`E2E_MVP_PLAN.md` §23.2.6) — matches SD §7.3's own TTL for this cache entry, only the key shape changed (D6's own bug fix). */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * `staplesNoteFn`'s single-table cache row shape on `parimaan-cache-{env}`
 * — `PK = "aiCache#staplesNote#{recipeSetHash}"` (D6's own locked key,
 * content-addressed on the planned recipe set, never the raw `listId`),
 * `SK` a constant since this cache has no further sub-partitioning (unlike
 * `dailyActionLimiter.ts`'s per-UTC-day `SK`). Two different
 * `recipeSetHash`es never collide by construction — they are different
 * partition keys entirely, not different rows under one partition.
 */
const PK_PREFIX = 'aiCache#staplesNote#';
const SK = 'NOTE';

const buildKey = (recipeSetHash: string): { PK: string; SK: string } => ({
  PK: `${PK_PREFIX}${recipeSetHash}`,
  SK,
});

interface CachedStaplesNoteItem {
  note: string;
}

const isCachedStaplesNoteItem = (value: unknown): value is CachedStaplesNoteItem =>
  typeof value === 'object' && value !== null && typeof (value as { note?: unknown }).note === 'string';

/**
 * Reads the cached note for `recipeSetHash`, or `null` on a genuine miss
 * (no item, or — defensively — an item whose shape doesn't match, treated
 * identically to a miss rather than thrown, since a malformed cache row is
 * never worth failing this best-effort feature over).
 */
export const getCachedStaplesNote = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  recipeSetHash: string,
): Promise<string | null> => {
  const result = await ddbClient.send(new GetCommand({ TableName: tableName, Key: buildKey(recipeSetHash) }));
  return isCachedStaplesNoteItem(result.Item) ? result.Item.note : null;
};

/**
 * Writes (or refreshes) the cached note for `recipeSetHash` with a 24-hour
 * TTL. Callers write this ONLY on a real cache miss plus a successful model
 * call (`staplesNoteFn`'s own doc, D2/D6) — never on a cache hit, which
 * would just re-write the identical value for no benefit.
 */
export const putCachedStaplesNote = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  recipeSetHash: string,
  note: string,
  now: () => Date = () => new Date(),
): Promise<void> => {
  const ttl = Math.floor(now().getTime() / 1000) + TTL_SECONDS;
  await ddbClient.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...buildKey(recipeSetHash), note, ttl },
    }),
  );
};
