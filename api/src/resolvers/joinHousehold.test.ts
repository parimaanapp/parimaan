import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import {
  findMembership,
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  insertMembershipWithinCap,
} from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createJoinHouseholdHandler } from './joinHousehold.js';
import type { JoinHouseholdResolverDeps } from './joinHousehold.js';
import { HouseholdFullError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';
import { HOUSEHOLD_MEMBER_CAP } from '../domain/householdLimits.js';
import { MAX_JOIN_ATTEMPTS_PER_DAY } from '../rateLimit/joinAttemptLimiter.js';

const buildEvent = (
  inviteCode: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ inviteCode: unknown }> => ({
  arguments: { inviteCode },
  identity:
    cognitoSub === null
      ? null
      : ({
          sub: cognitoSub,
          issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
          username: cognitoSub,
          claims: { email: `${cognitoSub}@example.test` },
          sourceIp: ['127.0.0.1'],
          defaultAuthStrategy: 'ALLOW',
          groups: null,
        } as unknown as AppSyncResolverEvent<{ inviteCode: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'joinHousehold',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('joinHousehold resolver', () => {
  let db: TestDatabase;
  let pool: Pool;
  let ddb: TestDynamoDb;

  beforeAll(async () => {
    [db, ddb] = await Promise.all([startTestDatabase(), startTestDynamoDb()]);
    pool = new Pool({ connectionString: db.appUri });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
    await ddb.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const baseDeps = (overrides: Partial<JoinHouseholdResolverDeps> = {}): JoinHouseholdResolverDeps => ({
    getPool: async () => pool,
    getDdbClient: () => ddb.client,
    getCacheTableName: () => ddb.tableName,
    ...overrides,
  });

  const createUser = async (cognitoSub: string): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, {
        cognitoSub,
        email: `${cognitoSub}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const createHouseholdWithMembers = async (
    owner: UserRow,
    inviteCode: string,
    extraMembers: UserRow[] = [],
  ): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, {
          name: `House ${inviteCode}`,
          inviteCode,
          primaryUserId: owner.id,
        });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        for (const member of extraMembers) {
          await insertMembershipWithinCap(client, { householdId: household.id, userId: member.id, role: 'member' }, 99);
        }
        return household.id;
      },
      pool,
    );

  // --- 1. authorization/denial ---

  it('rejects a null identity with UnauthorizedError, writing zero rows', async () => {
    const handler = createJoinHouseholdHandler(baseDeps());
    await expect(handler(buildEvent('ABC234', null))).rejects.toThrow(UnauthorizedError);
    expect((await pool.query('SELECT 1 FROM household_memberships')).rows).toHaveLength(0);
  });

  it('allows a non-member to join — joinHousehold deliberately has no requireHouseholdMember gate', async () => {
    const owner = await createUser('sub-owner-nogate');
    const inviteCode = 'NOG234';
    await createHouseholdWithMembers(owner, inviteCode);

    const handler = createJoinHouseholdHandler(baseDeps());
    const result = await handler(buildEvent(inviteCode, 'sub-joiner-nogate'));
    expect(result.members).toHaveLength(2);
  });

  // --- 2. Zod validation ---

  it.each([
    ['too short', 'ABC23'],
    ['too long', 'ABC2345'],
    ['absent', undefined],
    ['numeric', 123456],
  ])('rejects a %s inviteCode with ValidationError', async (_label, inviteCode) => {
    const handler = createJoinHouseholdHandler(baseDeps());
    await expect(handler(buildEvent(inviteCode, 'sub-validation'))).rejects.toThrow(ValidationError);
  });

  // --- 3. happy path ---

  it('happy path: joins as a member and returns the full household with members and settings', async () => {
    const owner = await createUser('sub-owner-happy');
    const inviteCode = 'HAP234';
    await createHouseholdWithMembers(owner, inviteCode);

    const handler = createJoinHouseholdHandler(baseDeps());
    const result = await handler(buildEvent(inviteCode, 'sub-joiner-happy'));

    expect(result.inviteCode).toBe(inviteCode);
    expect(result.members).toHaveLength(2);
    expect(result.members.map((m) => m.role).sort()).toEqual(['member', 'primary']);
    expect(result.settings.mealsEnabled).toEqual(['breakfast', 'lunch', 'dinner']);

    const client = await pool.connect();
    try {
      const joinerRow = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [
        'sub-joiner-happy',
      ]);
      const membershipRow = await client.query(
        'SELECT role FROM household_memberships WHERE user_id = $1',
        [joinerRow.rows[0].id],
      );
      expect(membershipRow.rows[0].role).toBe('member');
    } finally {
      client.release();
    }
  });

  it('throws NotFoundError for an unknown invite code, writing zero rows', async () => {
    const handler = createJoinHouseholdHandler(baseDeps());
    await expect(handler(buildEvent('ZZZZZZ', 'sub-unknown-code'))).rejects.toThrow(NotFoundError);
    expect((await pool.query('SELECT 1 FROM household_memberships')).rows).toHaveLength(0);
  });

  // --- 4. edge cases: idempotency, cap, rate limiting, concurrency ---

  it('is idempotent: re-joining a household the caller already belongs to succeeds without a second insert', async () => {
    const owner = await createUser('sub-owner-idem');
    const inviteCode = 'IDM234';
    await createHouseholdWithMembers(owner, inviteCode);

    const handler = createJoinHouseholdHandler(baseDeps());
    await handler(buildEvent(inviteCode, 'sub-joiner-idem'));
    const secondResult = await handler(buildEvent(inviteCode, 'sub-joiner-idem'));

    expect(secondResult.members).toHaveLength(2);
    const client = await pool.connect();
    try {
      const joinerRow = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [
        'sub-joiner-idem',
      ]);
      const membershipRows = await client.query(
        'SELECT * FROM household_memberships WHERE user_id = $1',
        [joinerRow.rows[0].id],
      );
      expect(membershipRows.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  it('idempotent re-join still succeeds via the 23505 fallback when the findMembership pre-check is forced to miss', async () => {
    const owner = await createUser('sub-owner-race');
    const inviteCode = 'RAC234';
    const householdId = await createHouseholdWithMembers(owner, inviteCode);

    const joiner = await createUser('sub-joiner-race');
    await withUserTransaction(
      joiner.id,
      (client) =>
        insertMembershipWithinCap(client, { householdId, userId: joiner.id, role: 'member' }, 99),
      pool,
    );

    // Force the pre-check to always report "not a member" even though the
    // joiner already has a row — only the 23505 unique-violation fallback
    // inside joinAsMember can save this from a raw duplicate-key error.
    const handler = createJoinHouseholdHandler(
      baseDeps({ findMembership: async () => null }),
    );

    const result = await handler(buildEvent(inviteCode, 'sub-joiner-race'));
    expect(result.members).toHaveLength(2);

    const membershipRows = await pool.query(
      'SELECT * FROM household_memberships WHERE user_id = $1',
      [joiner.id],
    );
    expect(membershipRows.rows).toHaveLength(1);
  });

  it('throws HouseholdFullError without inserting once the household is at the member cap', async () => {
    const owner = await createUser('sub-owner-cap');
    const inviteCode = 'CAP234';
    const extraMembers = await Promise.all(
      Array.from({ length: HOUSEHOLD_MEMBER_CAP - 1 }, (_, i) => createUser(`sub-cap-extra-${i}`)),
    );
    await createHouseholdWithMembers(owner, inviteCode, extraMembers);

    const handler = createJoinHouseholdHandler(baseDeps());
    await expect(handler(buildEvent(inviteCode, 'sub-joiner-cap'))).rejects.toThrow(HouseholdFullError);

    const count = await pool.query('SELECT count(*)::int AS n FROM household_memberships');
    expect(count.rows[0].n).toBe(HOUSEHOLD_MEMBER_CAP);
  });

  it('rate-limits: the 21st join attempt in a day throws before any household lookup, even for a valid invite code', async () => {
    const owner = await createUser('sub-owner-ratelimit');
    const inviteCode = 'RTL234';
    await createHouseholdWithMembers(owner, inviteCode);

    const joinerSub = 'sub-joiner-ratelimit';
    const fixedNow = (): Date => new Date('2026-08-19T10:00:00.000Z');
    const handler = createJoinHouseholdHandler(baseDeps({ now: fixedNow }));

    // Burn the daily budget with a bad invite code each time — proves the
    // rate limit is checked before the (failing) household lookup, not after.
    for (let i = 0; i < MAX_JOIN_ATTEMPTS_PER_DAY; i += 1) {
      await expect(handler(buildEvent('ZZZZZZ', joinerSub))).rejects.toThrow(NotFoundError);
    }

    await expect(handler(buildEvent(inviteCode, joinerSub))).rejects.toThrow(
      /Too many join attempts/,
    );

    const membershipCount = await pool.query('SELECT count(*)::int AS n FROM household_memberships');
    expect(membershipCount.rows[0].n).toBe(1); // only the owner — the rate-limited attempt never reached the household.
  });

  it('5-member cap under real concurrency (end-to-end through the resolver): exactly one of two simultaneous joins succeeds, final count is 5', async () => {
    const owner = await createUser('sub-owner-concurrency');
    const inviteCode = 'CON234';
    // owner + 3 extra members = 4 total, leaving exactly one open seat before the cap of 5.
    const extraMembers = await Promise.all(
      Array.from({ length: HOUSEHOLD_MEMBER_CAP - 2 }, (_, i) => createUser(`sub-con-extra-${i}`)),
    );
    await createHouseholdWithMembers(owner, inviteCode, extraMembers);

    const preCount = await pool.query('SELECT count(*)::int AS n FROM household_memberships');
    expect(preCount.rows[0].n).toBe(HOUSEHOLD_MEMBER_CAP - 1);

    const contenderHandlerA = createJoinHouseholdHandler(baseDeps({ now: () => new Date('2026-08-19T00:00:00.000Z') }));
    const contenderHandlerB = createJoinHouseholdHandler(baseDeps({ now: () => new Date('2026-08-19T00:00:00.000Z') }));

    const settled = await Promise.allSettled([
      contenderHandlerA(buildEvent(inviteCode, 'sub-con-final-a')),
      contenderHandlerB(buildEvent(inviteCode, 'sub-con-final-b')),
    ]);

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HouseholdFullError);

    const finalCount = await pool.query('SELECT count(*)::int AS n FROM household_memberships');
    expect(finalCount.rows[0].n).toBe(HOUSEHOLD_MEMBER_CAP);
  });

  it("cross-tenant sanity: joining household A never creates a membership row in household B", async () => {
    const ownerA = await createUser('sub-owner-cross-a');
    const ownerB = await createUser('sub-owner-cross-b');
    const inviteA = 'CRA234';
    const inviteB = 'CRB234';
    const householdBId = await createHouseholdWithMembers(ownerB, inviteB);
    await createHouseholdWithMembers(ownerA, inviteA);

    const handler = createJoinHouseholdHandler(baseDeps());
    await handler(buildEvent(inviteA, 'sub-joiner-cross'));

    const joinerId = (
      await pool.query('SELECT id FROM users WHERE cognito_sub = $1', ['sub-joiner-cross'])
    ).rows[0].id as string;
    const membershipInB = await withUserTransaction(
      joinerId,
      (client) => findMembership(client, householdBId, joinerId),
      pool,
    );
    expect(membershipInB).toBeNull();
  });
});
