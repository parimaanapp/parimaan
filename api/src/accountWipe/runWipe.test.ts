import { describe, expect, it } from 'vitest';
import { hashListing } from './listingHash.js';
import { buildListing, runWipe } from './runWipe.js';
import { createFakePorts, emptyDbListing, FAKE_TARGET } from './testing/fakes.js';
import type { CognitoUser, DbListing } from './types.js';

const EMAILS = ['a@x.test', 'b@x.test'] as const;
const SUB = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const KEPT_HOUSEHOLD = '44444444-4444-4444-8444-444444444444';

const cognitoUser: CognitoUser = { username: 'Google_1', sub: SUB, email: 'a@x.test' };

const populatedDb = (): DbListing => ({
  ...emptyDbListing(),
  users: [{ id: USER_ID, cognitoSub: SUB, email: 'a@x.test' }],
  householdsDeleted: [{ id: HOUSEHOLD, name: 'Home' }],
  householdsKept: [{ id: KEPT_HOUSEHOLD, name: 'Shared', remainingMemberCount: 1, wipedMemberCount: 1 }],
  tables: emptyDbListing().tables.map((t) =>
    t.table === 'pantry_items' ? { ...t, keys: ['p1', 'p2'] } : t,
  ),
});

const seeded = () =>
  createFakePorts({
    cognito: [cognitoUser],
    dbListing: populatedDb(),
    objects: [
      { bucket: 'uploads-bucket', key: `pantry-photos/${SUB}/x.jpg` },
      { bucket: 'exports-bucket', key: `exports/${HOUSEHOLD}/l/1.png` },
      { bucket: 'uploads-bucket', key: 'pantry-photos/someone-else/y.jpg' },
    ],
    cache: [
      { pk: `RATELIMIT#joinAttempt#${USER_ID}`, sk: '2026-10-15' },
      { pk: `aiCache#cookFromPantry#${HOUSEHOLD}#hash`, sk: 'v1' },
      { pk: 'aiCache#staplesNote#unrelated', sk: 'v1' },
    ],
  });

describe('runWipe', () => {
  it('dry run reports without mutating anything', async () => {
    const { ports, world } = seeded();
    const outcome = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
    expect(outcome.mode).toBe('dry-run');
    expect(outcome.listing.cognito).toEqual([cognitoUser]);
    expect(outcome.listing.objects.map((o) => o.key).sort()).toEqual([
      `exports/${HOUSEHOLD}/l/1.png`,
      `pantry-photos/${SUB}/x.jpg`,
    ]);
    expect(outcome.listing.cache).toHaveLength(2);
    expect(outcome.hash).toBe(hashListing(outcome.listing));
    expect(world.events).toEqual([]);
    expect(world.cognito).toHaveLength(1);
    expect(world.objects).toHaveLength(3);
  });

  it('refuses to execute without a confirmation hash', async () => {
    const { ports, world } = seeded();
    await expect(runWipe(ports, { mode: 'execute', emails: EMAILS })).rejects.toThrow(/--confirm/);
    expect(world.events).toEqual([]);
  });

  it('refuses to execute when the confirmation hash does not match the current listing', async () => {
    const { ports, world } = seeded();
    await expect(
      runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: 'deadbeef' }),
    ).rejects.toThrow(/does not match/);
    expect(world.events).toEqual([]);
    expect(world.cognito).toHaveLength(1);
  });

  it('executes in order disable -> s3 -> cache -> db -> cognito delete and proves zero remain', async () => {
    const { ports, world } = seeded();
    const dry = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
    const outcome = await runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: dry.hash });
    expect(world.events).toEqual([
      'cognito:disable',
      's3:delete',
      'cache:delete',
      'db:transaction',
      'cognito:delete',
    ]);
    expect(outcome.mode).toBe('execute');
    if (outcome.mode !== 'execute') throw new Error('unreachable');
    expect(outcome.remaining.total).toBe(0);
    expect(world.objects.map((o) => o.key)).toEqual(['pantry-photos/someone-else/y.jpg']);
    expect(world.cache.map((c) => c.pk)).toEqual(['aiCache#staplesNote#unrelated']);
    expect(world.cognito).toEqual([]);
  });

  it('second execute run is a no-op and still succeeds', async () => {
    const { ports, world } = seeded();
    const dry = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
    await runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: dry.hash });
    const eventsAfterFirst = [...world.events];

    const again = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
    const second = await runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: again.hash });
    if (second.mode !== 'execute') throw new Error('unreachable');
    expect(second.remaining.total).toBe(0);
    expect(world.events.filter((e) => e !== 'db:transaction')).toEqual(
      eventsAfterFirst.filter((e) => e !== 'db:transaction'),
    );
  });

  it('keeps the kept household reported but never counts it as remaining wipe data', async () => {
    const { ports } = seeded();
    const listing = await buildListing(ports, EMAILS);
    expect(listing.db.householdsKept).toHaveLength(1);
  });

  it('normalises and de-duplicates emails', async () => {
    const { ports } = seeded();
    const outcome = await runWipe(ports, {
      mode: 'dry-run',
      emails: ['A@X.test', 'a@x.test ', 'b@x.test'],
    });
    expect(outcome.listing.emails).toEqual(['a@x.test', 'b@x.test']);
  });

  it('rejects an empty or malformed email list', async () => {
    const { ports } = seeded();
    await expect(runWipe(ports, { mode: 'dry-run', emails: [] })).rejects.toThrow(/at least one/i);
    await expect(runWipe(ports, { mode: 'dry-run', emails: ['nope'] })).rejects.toThrow(/valid email/);
  });

  describe('target binding (H1)', () => {
    it('aborts before reading anything when the target verification fails', async () => {
      const { ports, world } = createFakePorts({
        targetError: 'Refusing to run: AWS account 9 is not the expected account 1.',
        dbListing: populatedDb(),
        cognito: [cognitoUser],
      });
      await expect(runWipe(ports, { mode: 'dry-run', emails: EMAILS })).rejects.toThrow(/expected account/);
      expect(world.events).toEqual([]);
      expect(world.listings).toEqual([]);
      expect(world.scans).toEqual([]);
    });

    it('puts the target in the listing and binds the hash to it', async () => {
      const { ports } = seeded();
      const outcome = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
      expect(outcome.listing.target).toEqual(FAKE_TARGET);
      const other = { ...outcome.listing, target: { ...FAKE_TARGET, accountId: '999999999999' } };
      expect(hashListing(other)).not.toBe(outcome.hash);
    });
  });

  describe('identifier validation (M1)', () => {
    const withUser = (user: { id: string; cognitoSub: string }) =>
      createFakePorts({
        dbListing: {
          ...populatedDb(),
          users: [{ ...user, email: 'a@x.test' }],
        },
      });

    it('aborts before any S3 listing or cache scan when a cognito sub is empty', async () => {
      const { ports, world } = withUser({ id: USER_ID, cognitoSub: '' });
      await expect(runWipe(ports, { mode: 'dry-run', emails: EMAILS })).rejects.toThrow(/empty/);
      expect(world.listings).toEqual([]);
      expect(world.scans).toEqual([]);
    });

    it('aborts when an id is not a UUID ("sub-1")', async () => {
      const { ports, world } = withUser({ id: USER_ID, cognitoSub: 'sub-1' });
      await expect(runWipe(ports, { mode: 'dry-run', emails: EMAILS })).rejects.toThrow(/UUID/);
      expect(world.scans).toEqual([]);
    });

    it('aborts when a deleted household id is not a UUID', async () => {
      const { ports } = createFakePorts({
        dbListing: { ...populatedDb(), householdsDeleted: [{ id: 'h-1', name: 'x' }] },
      });
      await expect(runWipe(ports, { mode: 'dry-run', emails: EMAILS })).rejects.toThrow(/household id/);
    });

    it('does not match a cache item for sub "...10" when wiping sub "...1"', async () => {
      const sub10 = `${SUB}0`;
      const { ports } = createFakePorts({
        cognito: [cognitoUser],
        dbListing: populatedDb(),
        cache: [{ pk: `RATELIMIT#joinAttempt#${sub10}`, sk: 'd' }],
      });
      const outcome = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
      expect(outcome.listing.cache).toEqual([]);
    });
  });

  describe('partial failure safety (M2)', () => {
    const rerun = async (ports: ReturnType<typeof seeded>['ports']) => {
      const dry = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
      return runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: dry.hash });
    };
    const firstExecute = async (ports: ReturnType<typeof seeded>['ports']) => {
      const dry = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
      return runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: dry.hash });
    };

    it('disables Cognito users before anything else is touched', async () => {
      const { ports, world } = seeded();
      await firstExecute(ports);
      expect(world.events[0]).toBe('cognito:disable');
      expect(world.disabled).toEqual(['Google_1']);
    });

    it('fails at disable: nothing deleted, re-run completes', async () => {
      const { ports, world } = seeded();
      world.failOn = 'cognito:disable';
      await expect(firstExecute(ports)).rejects.toThrow(/cognito:disable/);
      expect(world.events).toEqual([]);
      expect(world.objects).toHaveLength(3);
      world.failOn = undefined;
      const outcome = await rerun(ports);
      if (outcome.mode !== 'execute') throw new Error('unreachable');
      expect(outcome.remaining.total).toBe(0);
    });

    it.each(['s3:delete', 'cache:delete', 'db:transaction', 'cognito:delete'])(
      'fails at %s: the DB is never committed ahead of external data, and a re-run completes',
      async (step) => {
        const { ports, world } = seeded();
        world.failOn = step;
        await expect(firstExecute(ports)).rejects.toThrow(step);
        // Every external listing source (DB users/households, Cognito subs) must still be
        // discoverable unless that step's own data is already gone.
        if (step !== 'cognito:delete') {
          expect(world.events).not.toContain('cognito:delete');
        }
        if (['s3:delete', 'cache:delete'].includes(step)) {
          expect(world.events).not.toContain('db:transaction');
          expect(world.dbListing.users).toHaveLength(1);
        }
        world.failOn = undefined;
        const outcome = await rerun(ports);
        if (outcome.mode !== 'execute') throw new Error('unreachable');
        expect(outcome.remaining.total).toBe(0);
        expect(world.objects.map((o) => o.key)).toEqual(['pantry-photos/someone-else/y.jpg']);
        expect(world.cache.map((c) => c.pk)).toEqual(['aiCache#staplesNote#unrelated']);
        expect(world.cognito).toEqual([]);
      },
    );

    it('re-running after full success is a no-op that still passes', async () => {
      const { ports, world } = seeded();
      await firstExecute(ports);
      const before = [...world.events];
      const outcome = await rerun(ports);
      if (outcome.mode !== 'execute') throw new Error('unreachable');
      expect(outcome.remaining.total).toBe(0);
      expect(world.events.slice(0, before.length)).toEqual(before);
    });
  });

  describe('cognito lookup (M3)', () => {
    it('finds a user stored with mixed case via the original-case input', async () => {
      const mixed: CognitoUser = { username: 'Google_2', sub: SUB, email: 'Mixed@X.test' };
      const { ports } = createFakePorts({ cognito: [mixed] });
      const listing = await buildListing(ports, ['Mixed@X.test']);
      expect(listing.cognito).toEqual([mixed]);
    });

    it('finds a DB user whose Cognito email differs only by case via the sub, no warning', async () => {
      const mixed: CognitoUser = { username: 'Google_3', sub: SUB, email: 'A@X.TEST' };
      const { ports } = createFakePorts({ cognito: [mixed], dbListing: populatedDb() });
      const listing = await buildListing(ports, ['a@x.test']);
      expect(listing.cognito).toEqual([mixed]);
      expect(listing.warnings).toEqual([]);
    });

    it('warns loudly for a DB user whose sub is not in Cognito', async () => {
      const { ports } = createFakePorts({ dbListing: populatedDb() });
      const listing = await buildListing(ports, ['a@x.test']);
      expect(listing.cognito).toEqual([]);
      expect(listing.warnings).toHaveLength(1);
      expect(listing.warnings[0]).toMatch(/WARNING/);
      expect(listing.warnings[0]).toContain(SUB);
      expect(listing.warnings[0]).toContain('a@x.test');
    });
  });
});
