import { DELETE_STEPS } from '../steps.js';
import type {
  CacheKey,
  CognitoUser,
  DbDeleteResult,
  DbListing,
  ObjectRef,
  TargetInfo,
  WipeDb,
  WipeListing,
  WipePorts,
} from '../types.js';

export const emptyDbListing = (): DbListing => ({
  users: [],
  householdsDeleted: [],
  householdsKept: [],
  promotions: [],
  nullifiedReferences: [],
  tables: DELETE_STEPS.map((s) => ({ table: s.table, keys: [] })),
});

export const FAKE_TARGET: TargetInfo = {
  accountId: '123456789012',
  userPoolId: 'pool-1',
  userPoolName: 'parimaan-dev',
  dbHost: 'db.dev.rds.test',
  dbName: 'parimaan',
  region: 'ap-south-1',
  uploadsBucket: 'uploads-bucket',
  exportsBucket: 'exports-bucket',
  cacheTable: 'cache-dev',
};

export const emptyListing = (emails: readonly string[]): WipeListing => ({
  target: FAKE_TARGET,
  warnings: [],
  emails,
  cognito: [],
  db: emptyDbListing(),
  objects: [],
  cache: [],
});

/** What the fakes record, so tests can assert ordering and mutation. */
export interface FakeWorld {
  events: string[];
  cognito: CognitoUser[];
  objects: ObjectRef[];
  cache: CacheKey[];
  dbListing: DbListing;
  /** Names a step ('cognito:disable' | 's3:delete' | 'cache:delete' | 'db:transaction' | 'cognito:delete') that throws once reached. */
  failOn: string | undefined;
  disabled: string[];
  signedOut: string[];
  /** Number of `db.snapshot` calls so far. */
  snapshots: number;
  /** Runs at the START of the n-th (1-based) `db.snapshot`, so tests can change the DB between reads. */
  onSnapshot: ((n: number, world: FakeWorld) => void) | undefined;
  /** Deletes that silently do nothing, so tests can prove post-delete verification catches leftovers. */
  retain: { objects: boolean; cache: boolean };
  /** Identifier lists passed to cache scans / S3 listings, so tests can prove nothing ran. */
  scans: string[][];
  listings: string[];
}

const failIfRequested = (world: FakeWorld, step: string): void => {
  if (world.failOn === step) {
    throw new Error(`fake failure at ${step}`);
  }
};

const withoutDeleted = <T>(items: readonly T[], deleted: readonly T[]): T[] =>
  items.filter((i) => !deleted.some((d) => JSON.stringify(d) === JSON.stringify(i)));

class FakeDb implements WipeDb {
  constructor(private readonly world: FakeWorld) {}

  async snapshot(): Promise<DbListing> {
    this.world.snapshots += 1;
    this.world.onSnapshot?.(this.world.snapshots, this.world);
    return this.world.dbListing;
  }

  async execute(
    _emails: readonly string[],
    _subs: readonly string[],
    expected: DbListing,
  ): Promise<DbDeleteResult> {
    if (JSON.stringify(expected) !== JSON.stringify(this.world.dbListing)) {
      throw new Error('fake db: expected listing no longer matches');
    }
    failIfRequested(this.world, 'db:transaction');
    this.world.events.push('db:transaction');
    const result: DbDeleteResult = {
      deletedByTable: this.world.dbListing.tables.map((t) => ({
        table: t.table,
        count: t.keys.length,
      })),
      promotionsApplied: this.world.dbListing.promotions.length,
    };
    this.world.dbListing = {
      ...emptyDbListing(),
      householdsKept: this.world.dbListing.householdsKept,
    };
    return result;
  }
}

export interface FakePortsOptions {
  readonly cognito?: readonly CognitoUser[];
  readonly objects?: readonly ObjectRef[];
  readonly cache?: readonly CacheKey[];
  readonly dbListing?: DbListing;
  readonly failOn?: string;
  readonly targetError?: string;
}

const createWorld = (options: FakePortsOptions): FakeWorld => ({
  events: [],
  cognito: [...(options.cognito ?? [])],
  objects: [...(options.objects ?? [])],
  cache: [...(options.cache ?? [])],
  dbListing: options.dbListing ?? emptyDbListing(),
  failOn: options.failOn,
  disabled: [],
  signedOut: [],
  snapshots: 0,
  onSnapshot: undefined,
  retain: { objects: false, cache: false },
  scans: [],
  listings: [],
});

const buildPorts = (world: FakeWorld, options: FakePortsOptions): WipePorts => ({
  db: new FakeDb(world),
  buckets: { uploads: 'uploads-bucket', exports: 'exports-bucket' },
  objects: {
    list: async (prefixes) => {
      world.listings.push(...prefixes.map((p) => p.prefix));
      return world.objects.filter((o) =>
        prefixes.some((p) => p.bucket === o.bucket && o.key.startsWith(p.prefix)),
      );
    },
    delete: async (objs) => {
      failIfRequested(world, 's3:delete');
      world.events.push('s3:delete');
      if (!world.retain.objects) world.objects = withoutDeleted(world.objects, objs);
    },
  },
  cache: {
    findByIdentifiers: async (ids) => {
      world.scans.push([...ids]);
      return world.cache.filter((c) => ids.some((id) => c.pk.split('#').includes(id)));
    },
    delete: async (keys) => {
      failIfRequested(world, 'cache:delete');
      world.events.push('cache:delete');
      if (!world.retain.cache) world.cache = withoutDeleted(world.cache, keys);
    },
  },
  identity: {
    // Case-sensitive on purpose: that is how Cognito's email filter behaves.
    findByEmail: async (email) => world.cognito.filter((u) => u.email === email),
    findBySub: async (sub) => world.cognito.filter((u) => u.sub === sub),
    disableUser: async (username) => {
      failIfRequested(world, 'cognito:disable');
      world.events.push('cognito:disable');
      world.disabled = [...world.disabled, username];
    },
    globalSignOut: async (username) => {
      failIfRequested(world, 'cognito:signout');
      world.events.push('cognito:signout');
      world.signedOut = [...world.signedOut, username];
    },
    deleteUser: async (username) => {
      failIfRequested(world, 'cognito:delete');
      world.events.push('cognito:delete');
      world.cognito = world.cognito.filter((u) => u.username !== username);
    },
  },
  target: {
    verify: async () => {
      if (options.targetError !== undefined) {
        throw new Error(options.targetError);
      }
      return FAKE_TARGET;
    },
  },
});

export const createFakePorts = (
  options: FakePortsOptions = {},
): { ports: WipePorts; world: FakeWorld } => {
  const world = createWorld(options);
  return { ports: buildPorts(world, options), world };
};
