import { DELETE_STEPS } from '../steps.js';
import type {
  CacheKey,
  CognitoUser,
  DbDeleteResult,
  DbListing,
  ObjectRef,
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

export const emptyListing = (emails: readonly string[]): WipeListing => ({
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
}

const withoutDeleted = <T>(items: readonly T[], deleted: readonly T[]): T[] =>
  items.filter((i) => !deleted.some((d) => JSON.stringify(d) === JSON.stringify(i)));

class FakeDb implements WipeDb {
  constructor(private readonly world: FakeWorld) {}

  async snapshot(): Promise<DbListing> {
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
}

export const createFakePorts = (
  options: FakePortsOptions = {},
): { ports: WipePorts; world: FakeWorld } => {
  const world: FakeWorld = {
    events: [],
    cognito: [...(options.cognito ?? [])],
    objects: [...(options.objects ?? [])],
    cache: [...(options.cache ?? [])],
    dbListing: options.dbListing ?? emptyDbListing(),
  };
  const ports: WipePorts = {
    db: new FakeDb(world),
    buckets: { uploads: 'uploads-bucket', exports: 'exports-bucket' },
    objects: {
      list: async (prefixes) =>
        world.objects.filter((o) =>
          prefixes.some((p) => p.bucket === o.bucket && o.key.startsWith(p.prefix)),
        ),
      delete: async (objs) => {
        world.events.push('s3:delete');
        world.objects = withoutDeleted(world.objects, objs);
      },
    },
    cache: {
      findByIdentifiers: async (ids) =>
        world.cache.filter((c) => ids.some((id) => c.pk.includes(id))),
      delete: async (keys) => {
        world.events.push('cache:delete');
        world.cache = withoutDeleted(world.cache, keys);
      },
    },
    identity: {
      findByEmail: async (email) => world.cognito.filter((u) => u.email === email),
      deleteUser: async (username) => {
        world.events.push('cognito:delete');
        world.cognito = world.cognito.filter((u) => u.username !== username);
      },
    },
  };
  return { ports, world };
};
