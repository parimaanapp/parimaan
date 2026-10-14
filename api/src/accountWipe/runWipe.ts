import { hashListing } from './listingHash.js';
import type {
  CacheKey,
  CognitoUser,
  DbDeleteResult,
  ObjectRef,
  WipeListing,
  WipePorts,
} from './types.js';

export interface RunWipeOptions {
  readonly mode: 'dry-run' | 'execute';
  readonly emails: readonly string[];
  /** Listing hash printed by a previous dry run. Required for `execute`. */
  readonly confirm?: string;
}

export interface RemainingCounts {
  readonly dbRows: number;
  readonly objects: number;
  readonly cacheItems: number;
  readonly cognitoUsers: number;
  readonly total: number;
}

export type WipeOutcome =
  | { readonly mode: 'dry-run'; readonly listing: WipeListing; readonly hash: string }
  | {
      readonly mode: 'execute';
      readonly listing: WipeListing;
      readonly hash: string;
      readonly dbResult: DbDeleteResult;
      readonly remaining: RemainingCounts;
    };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliseEmails = (emails: readonly string[]): string[] => {
  const cleaned = emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
  if (cleaned.length === 0) {
    throw new Error('At least one email is required.');
  }
  const invalid = cleaned.find((e) => !EMAIL_PATTERN.test(e));
  if (invalid !== undefined) {
    throw new Error(`"${invalid}" is not a valid email address.`);
  }
  return [...new Set(cleaned)].sort();
};

const sortBy = <T>(items: readonly T[], key: (t: T) => string): T[] =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)));

const dedupeBy = <T>(items: readonly T[], key: (t: T) => string): T[] => [
  ...new Map(items.map((i) => [key(i), i] as const)).values(),
];

const findCognitoUsers = async (
  ports: WipePorts,
  emails: readonly string[],
): Promise<CognitoUser[]> => {
  const found = (await Promise.all(emails.map((e) => ports.identity.findByEmail(e)))).flat();
  return sortBy(dedupeBy(found, (u) => u.username), (u) => u.username);
};

/** Builds the full, deterministic, read-only listing of everything that would be deleted. */
export const buildListing = async (
  ports: WipePorts,
  rawEmails: readonly string[],
): Promise<WipeListing> => {
  const emails = normaliseEmails(rawEmails);
  const cognito = await findCognitoUsers(ports, emails);
  const cognitoSubs = cognito.map((u) => u.sub);
  const db = await ports.db.snapshot(emails, cognitoSubs);

  const subs = [...new Set([...cognitoSubs, ...db.users.map((u) => u.cognitoSub)])].sort();
  const prefixes = [
    ...subs.map((sub) => ({ bucket: ports.buckets.uploads, prefix: `pantry-photos/${sub}/` })),
    ...db.householdsDeleted.map((h) => ({
      bucket: ports.buckets.exports,
      prefix: `exports/${h.id}/`,
    })),
  ];
  const objects: ObjectRef[] =
    prefixes.length === 0 ? [] : [...(await ports.objects.list(prefixes))];

  const identifiers = [
    ...db.users.map((u) => u.id),
    ...subs,
    ...db.householdsDeleted.map((h) => h.id),
  ];
  const cache: CacheKey[] =
    identifiers.length === 0 ? [] : [...(await ports.cache.findByIdentifiers(identifiers))];

  return {
    emails,
    cognito,
    db,
    objects: sortBy(dedupeBy(objects, (o) => `${o.bucket}/${o.key}`), (o) => `${o.bucket}/${o.key}`),
    cache: sortBy(dedupeBy(cache, (c) => `${c.pk}|${c.sk}`), (c) => `${c.pk}|${c.sk}`),
  };
};

export const countRemaining = (listing: WipeListing): RemainingCounts => {
  const dbRows =
    listing.db.tables.reduce((sum, t) => sum + t.keys.length, 0) + listing.db.promotions.length;
  const objects = listing.objects.length;
  const cacheItems = listing.cache.length;
  const cognitoUsers = listing.cognito.length;
  return { dbRows, objects, cacheItems, cognitoUsers, total: dbRows + objects + cacheItems + cognitoUsers };
};

const assertConfirmation = (confirm: string | undefined, actual: string): void => {
  if (confirm === undefined || confirm.length === 0) {
    throw new Error(
      'Refusing to execute: --confirm <listing-hash> is required. Run --dry-run first, have the listing approved, then pass its hash.',
    );
  }
  if (confirm !== actual) {
    throw new Error(
      'Refusing to execute: --confirm does not match the current listing hash. The data changed since the approved dry run, or the hash is wrong. Re-run --dry-run and re-approve.',
    );
  }
};

/**
 * Entry point. `dry-run` is strictly read-only. `execute` recomputes the
 * listing, requires its hash to equal `confirm`, then deletes in the order
 * DB (one transaction) -> S3 -> DynamoDB cache -> Cognito, and re-runs the
 * listing to prove zero remain. Safe to re-run: an already-clean target
 * produces an empty listing and every delete step is a no-op.
 */
export const runWipe = async (ports: WipePorts, options: RunWipeOptions): Promise<WipeOutcome> => {
  const listing = await buildListing(ports, options.emails);
  const hash = hashListing(listing);

  if (options.mode === 'dry-run') {
    return { mode: 'dry-run', listing, hash };
  }

  assertConfirmation(options.confirm, hash);

  const cognitoSubs = listing.cognito.map((u) => u.sub);
  const dbResult = await ports.db.execute(listing.emails, cognitoSubs, listing.db);
  if (listing.objects.length > 0) {
    await ports.objects.delete(listing.objects);
  }
  if (listing.cache.length > 0) {
    await ports.cache.delete(listing.cache);
  }
  for (const user of listing.cognito) {
    await ports.identity.deleteUser(user.username);
  }

  const after = await buildListing(ports, options.emails);
  const remaining = countRemaining(after);
  if (remaining.total !== 0) {
    throw new Error(
      `Verification failed: ${remaining.total} item(s) remain after deletion ` +
        `(db rows ${remaining.dbRows}, objects ${remaining.objects}, cache ${remaining.cacheItems}, ` +
        `cognito users ${remaining.cognitoUsers}). Re-run to retry; the tool is idempotent.`,
    );
  }
  return { mode: 'execute', listing, hash, dbResult, remaining };
};
