import { assertUuidIdentifiers } from './identifiers.js';
import { hashListing } from './listingHash.js';
import type {
  CacheKey,
  CognitoUser,
  DbDeleteResult,
  DbListing,
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

const lookupVariants = (rawEmails: readonly string[], normalised: string): string[] => [
  ...new Set([
    ...rawEmails.map((e) => e.trim()).filter((e) => e.toLowerCase() === normalised),
    normalised,
  ]),
];

/**
 * Cognito's email filter is case-sensitive, so each account is looked up under
 * every spelling the operator typed plus its lowercase form. Anything still
 * missed is caught by sub (see `findMissingBySub`).
 */
const findCognitoUsers = async (
  ports: WipePorts,
  rawEmails: readonly string[],
  emails: readonly string[],
): Promise<CognitoUser[]> => {
  const wanted = new Set(emails);
  const lookups = emails.flatMap((email) =>
    lookupVariants(rawEmails, email).map((variant) => ports.identity.findByEmail(variant)),
  );
  const found = (await Promise.all(lookups))
    .flat()
    .filter((u) => wanted.has(u.email.trim().toLowerCase()));
  return sortBy(dedupeBy(found, (u) => u.username), (u) => u.username);
};

/** DB users whose Cognito user was not found by email: look them up by sub, and warn when still absent. */
const resolveMissingBySub = async (
  ports: WipePorts,
  found: readonly CognitoUser[],
  db: DbListing,
): Promise<{ users: CognitoUser[]; warnings: string[] }> => {
  const known = new Set(found.map((u) => u.sub));
  const missing = db.users.filter((u) => u.cognitoSub.length > 0 && !known.has(u.cognitoSub));
  const lookedUp = await Promise.all(
    missing.map(async (u) => ({ user: u, hits: await ports.identity.findBySub(u.cognitoSub) })),
  );
  const warnings = lookedUp
    .filter((l) => l.hits.length === 0)
    .map(
      (l) =>
        `WARNING: database user ${l.user.id} (${l.user.email}) has cognito_sub ${l.user.cognitoSub} ` +
        'but no matching Cognito user was found in this pool. It may already be deleted, belong to another ' +
        'pool, or have been missed by the email lookup; it will NOT be disabled or deleted by this run.',
    );
  return { users: lookedUp.flatMap((l) => l.hits), warnings };
};

/** Builds the full, deterministic, read-only listing of everything that would be deleted. */
export const buildListing = async (
  ports: WipePorts,
  rawEmails: readonly string[],
): Promise<WipeListing> => {
  const emails = normaliseEmails(rawEmails);
  const target = await ports.target.verify();
  const byEmail = await findCognitoUsers(ports, rawEmails, emails);
  const db = await ports.db.snapshot(emails, byEmail.map((u) => u.sub));
  const extra = await resolveMissingBySub(ports, byEmail, db);
  const cognito = sortBy(dedupeBy([...byEmail, ...extra.users], (u) => u.username), (u) => u.username);

  const subs = [...new Set([...cognito.map((u) => u.sub), ...db.users.map((u) => u.cognitoSub)])].sort();
  assertUuidIdentifiers([
    ...db.users.map((u) => ({ kind: 'database user id', value: u.id })),
    ...subs.map((value) => ({ kind: 'cognito sub', value })),
    ...db.householdsDeleted.map((h) => ({ kind: 'household id', value: h.id })),
  ]);

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
    target,
    warnings: [...extra.warnings].sort(),
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
 * listing, requires its hash to equal `confirm`, then runs:
 *
 *   1. disable the matched Cognito users (so a login cannot re-provision rows),
 *   2. delete S3 objects, 3. delete DynamoDB cache items  (both listed from the DB
 *      and Cognito, which still exist at this point),
 *   4. the DB transaction (all or nothing),
 *   5. delete the Cognito users,
 *
 * then re-lists to prove zero remain. External data goes BEFORE the DB commit
 * because the DB is the source of the ids that locate it: if a step fails, every
 * later step's input is still discoverable and a re-run (dry-run, re-approve,
 * execute) finishes the job. Every delete is a no-op when its data is already
 * gone, so re-running a completed wipe is safe.
 */
export const runWipe = async (ports: WipePorts, options: RunWipeOptions): Promise<WipeOutcome> => {
  const listing = await buildListing(ports, options.emails);
  const hash = hashListing(listing);

  if (options.mode === 'dry-run') {
    return { mode: 'dry-run', listing, hash };
  }

  assertConfirmation(options.confirm, hash);

  for (const user of listing.cognito) {
    await ports.identity.disableUser(user.username);
  }
  if (listing.objects.length > 0) {
    await ports.objects.delete(listing.objects);
  }
  if (listing.cache.length > 0) {
    await ports.cache.delete(listing.cache);
  }
  const cognitoSubs = listing.cognito.map((u) => u.sub);
  const dbResult = await ports.db.execute(listing.emails, cognitoSubs, listing.db);
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
