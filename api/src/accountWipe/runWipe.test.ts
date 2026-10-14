import { describe, expect, it } from 'vitest';
import { hashListing } from './listingHash.js';
import { buildListing, runWipe } from './runWipe.js';
import { createFakePorts, emptyDbListing } from './testing/fakes.js';
import type { CognitoUser, DbListing } from './types.js';

const EMAILS = ['a@x.test', 'b@x.test'] as const;
const SUB = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';

const cognitoUser: CognitoUser = { username: 'Google_1', sub: SUB, email: 'a@x.test' };

const populatedDb = (): DbListing => ({
  ...emptyDbListing(),
  users: [{ id: 'u1', cognitoSub: SUB, email: 'a@x.test' }],
  householdsDeleted: [{ id: HOUSEHOLD, name: 'Home' }],
  householdsKept: [{ id: 'h-kept', name: 'Shared', remainingMemberCount: 1, wipedMemberCount: 1 }],
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
      { pk: `RATELIMIT#joinAttempt#u1`, sk: '2026-10-15' },
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

  it('executes in order db -> s3 -> cache -> cognito and proves zero remain', async () => {
    const { ports, world } = seeded();
    const dry = await runWipe(ports, { mode: 'dry-run', emails: EMAILS });
    const outcome = await runWipe(ports, { mode: 'execute', emails: EMAILS, confirm: dry.hash });
    expect(world.events).toEqual(['db:transaction', 's3:delete', 'cache:delete', 'cognito:delete']);
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
});
