/**
 * Shared types for the dev-only account wipe tool (E2E_MVP_PLAN.md §32.5).
 * Everything in a listing is plain, JSON-serialisable data so it can be
 * canonicalised and hashed (see `listingHash.ts`).
 */

export interface WipeUser {
  readonly id: string;
  readonly cognitoSub: string;
  readonly email: string;
}

export interface HouseholdMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly role: 'primary' | 'member';
  readonly joinedAt: string;
}

export interface HouseholdWithMembers {
  readonly id: string;
  readonly name: string;
  readonly primaryUserId: string | null;
  readonly members: readonly HouseholdMember[];
}

export interface KeptHousehold {
  readonly id: string;
  readonly name: string;
  readonly remainingMemberCount: number;
  readonly wipedMemberCount: number;
}

export interface PrimaryPromotion {
  readonly householdId: string;
  readonly membershipId: string;
  readonly newPrimaryUserId: string;
}

export interface HouseholdClassification {
  readonly deleted: readonly { readonly id: string; readonly name: string }[];
  readonly kept: readonly KeptHousehold[];
  readonly promotions: readonly PrimaryPromotion[];
}

export interface TableRows {
  readonly table: string;
  readonly keys: readonly string[];
}

export interface NullifiedReference {
  readonly table: string;
  readonly column: string;
  readonly count: number;
}

export interface DbListing {
  readonly users: readonly WipeUser[];
  readonly householdsDeleted: readonly { readonly id: string; readonly name: string }[];
  readonly householdsKept: readonly KeptHousehold[];
  readonly promotions: readonly PrimaryPromotion[];
  /** References in kept households that will be nulled by `ON DELETE SET NULL`. */
  readonly nullifiedReferences: readonly NullifiedReference[];
  /** Rows to delete, in the exact order they are deleted. */
  readonly tables: readonly TableRows[];
}

export interface CognitoUser {
  readonly username: string;
  readonly sub: string;
  readonly email: string;
}

export interface ObjectRef {
  readonly bucket: string;
  readonly key: string;
}

export interface CacheKey {
  readonly pk: string;
  readonly sk: string;
}

/** Non-secret description of what the tool is really pointed at. Part of the hashed listing. */
export interface TargetInfo {
  readonly accountId: string;
  readonly userPoolId: string;
  readonly userPoolName: string;
  readonly dbHost: string;
}

/** Resolves and verifies the target; must throw (fail closed) on any mismatch. */
export interface TargetVerifier {
  verify(): Promise<TargetInfo>;
}

export interface WipeListing {
  readonly target: TargetInfo;
  /** Loud, human-readable problems found while listing. Hashed, so approval covers them. */
  readonly warnings: readonly string[];
  readonly emails: readonly string[];
  readonly cognito: readonly CognitoUser[];
  readonly db: DbListing;
  readonly objects: readonly ObjectRef[];
  readonly cache: readonly CacheKey[];
}

export interface DbDeleteResult {
  readonly deletedByTable: readonly { readonly table: string; readonly count: number }[];
  readonly promotionsApplied: number;
}

/** DB side. `execute` must run in ONE transaction and refuse if the DB no longer matches `expected`. */
export interface WipeDb {
  snapshot(emails: readonly string[], extraCognitoSubs: readonly string[]): Promise<DbListing>;
  execute(
    emails: readonly string[],
    extraCognitoSubs: readonly string[],
    expected: DbListing,
  ): Promise<DbDeleteResult>;
}

export interface ObjectStore {
  /** `prefixes` are `{bucket, prefix}` pairs; returns every object beneath them. */
  list(
    prefixes: readonly { readonly bucket: string; readonly prefix: string }[],
  ): Promise<readonly ObjectRef[]>;
  delete(objects: readonly ObjectRef[]): Promise<void>;
}

export interface CacheStore {
  /**
   * Items whose partition key has a `#`-separated segment exactly equal to one
   * of the identifiers (never a substring match). Identifiers must be UUIDs.
   */
  findByIdentifiers(identifiers: readonly string[]): Promise<readonly CacheKey[]>;
  delete(keys: readonly CacheKey[]): Promise<void>;
}

export interface IdentityPool {
  /** Cognito's email filter is case-sensitive; implementations match case-insensitively on the result. */
  findByEmail(email: string): Promise<readonly CognitoUser[]>;
  findBySub(sub: string): Promise<readonly CognitoUser[]>;
  /** Blocks sign-in so a login cannot re-provision rows. Must treat "user does not exist" as success. */
  disableUser(username: string): Promise<void>;
  /** Must treat "user does not exist" as success (idempotent). */
  deleteUser(username: string): Promise<void>;
}

export interface WipePorts {
  readonly db: WipeDb;
  readonly objects: ObjectStore;
  readonly cache: CacheStore;
  readonly identity: IdentityPool;
  readonly target: TargetVerifier;
  readonly buckets: { readonly uploads: string; readonly exports: string };
}
