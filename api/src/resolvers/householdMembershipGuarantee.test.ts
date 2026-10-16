import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resetCallerUserCacheForTesting } from '../repositories/callerUser.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { ConflictError, ForbiddenError, HouseholdFullError, NotFoundError } from '../errors.js';
import { HOUSEHOLD_MEMBER_CAP } from '../domain/householdLimits.js';
import { INVITE_CODE_ALPHABET } from '../domain/inviteCode.js';
import type { RandomIntFn } from '../domain/inviteCode.js';
import { createMeHandler } from './me.js';
import { createCreateHouseholdHandler } from './createHousehold.js';
import { createJoinHouseholdHandler } from './joinHousehold.js';
import { createRotateInviteCodeHandler } from './rotateInviteCode.js';

/**
 * Evidence for E2E_MVP_PLAN.md section 33.6 (household membership guarantee):
 * the only code paths that add a `household_memberships` row are
 * `createHousehold` (the caller, `primary`, in the household it just created)
 * and `joinHousehold` (the caller, `member`, in the household whose invite
 * code it presented). Every other path below, including every failure and
 * retry, must leave the membership table exactly as it was, or add only
 * those rows.
 */

type Membership = string;

const identity = (sub: string, email: string): AppSyncResolverEvent<unknown>['identity'] =>
  ({
    sub,
    issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
    username: sub,
    claims: { email },
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
  }) as unknown as AppSyncResolverEvent<unknown>['identity'];

const event = <T>(args: T, sub: string, fieldName: string, email = `${sub}@example.test`): AppSyncResolverEvent<T> => ({
  arguments: args,
  identity: identity(sub, email),
  source: null,
  request: { headers: {}, domainName: null },
  info: { selectionSetList: ['id'], selectionSetGraphQL: '{ id }', parentTypeName: 'Mutation', fieldName, variables: {} },
  prev: null,
  stash: {},
});

/** Makes `generateInviteCode` spell out the given codes in order, one per attempt. */
const codeSequence = (codes: readonly string[]): RandomIntFn => {
  let call = 0;
  return () => {
    const code = codes[Math.floor(call / 6)];
    const char = code?.[call % 6];
    call += 1;
    if (char === undefined) {
      throw new Error('ran out of stubbed invite codes');
    }
    return INVITE_CODE_ALPHABET.indexOf(char);
  };
};

describe('household membership guarantee (section 33.6)', () => {
  let db: TestDatabase;
  let ddb: TestDynamoDb;
  let pool: Pool;

  beforeAll(async () => {
    [db, ddb] = await Promise.all([startTestDatabase(), startTestDynamoDb()]);
    pool = new Pool({ connectionString: db.appUri });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
    await ddb.stop();
  });

  beforeEach(() => {
    resetCallerUserCacheForTesting();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const deps = {
    getPool: async (): Promise<Pool> => pool,
    getDdbClient: () => ddb.client,
    getCacheTableName: () => ddb.tableName,
  };

  const createUser = async (sub: string, email = `${sub}@example.test`): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, { cognitoSub: sub, email, displayName: null, avatarUrl: null });
    } finally {
      client.release();
    }
  };

  const seedHousehold = async (owner: UserRow, inviteCode: string, members: readonly UserRow[] = []): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, { name: `House ${inviteCode}`, inviteCode, primaryUserId: owner.id });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        for (const member of members) {
          await insertMembership(client, { householdId: household.id, userId: member.id, role: 'member' });
        }
        return household.id;
      },
      pool,
    );

  /** Every membership as `household:user:role`. Read as the superuser so RLS cannot hide a row. */
  const memberships = async (): Promise<Membership[]> => {
    const result = await db.adminClient.query<{ household_id: string; user_id: string; role: string }>(
      'SELECT household_id, user_id, role FROM household_memberships',
    );
    return result.rows.map((row) => `${row.household_id}:${row.user_id}:${row.role}`).sort();
  };

  const added = (before: readonly Membership[], after: readonly Membership[]): Membership[] =>
    after.filter((row) => !before.includes(row));

  const membershipOf = (householdId: string, userId: string, role: string): Membership => `${householdId}:${userId}:${role}`;

  describe('sign-in and first-user upsert', () => {
    it('a first-ever sign-in creates a user and no membership anywhere', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      const me = await createMeHandler({ getPool: async () => pool })(event({}, 'sub-newcomer', 'me'));

      expect(me.email).toBe('sub-newcomer@example.test');
      expect(await memberships()).toEqual(before);
    });

    it('repeated sign-ins, even with a changed profile, add no membership', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();
      const handler = createMeHandler({ getPool: async () => pool });

      await handler(event({}, 'sub-returning', 'me'));
      resetCallerUserCacheForTesting();
      await handler(event({}, 'sub-returning', 'me', 'changed@example.test'));

      expect(await memberships()).toEqual(before);
    });

    it('an email that matches an existing member under a different sub is a ConflictError and grants nothing', async () => {
      const victim = await createUser('sub-victim', 'shared@example.test');
      const householdId = await seedHousehold(victim, 'AAA234');
      const before = await memberships();

      await expect(
        createMeHandler({ getPool: async () => pool })(event({}, 'sub-impostor', 'me', 'shared@example.test')),
      ).rejects.toThrow(ConflictError);

      expect(await memberships()).toEqual(before);
      const impostor = await db.adminClient.query('SELECT 1 FROM users WHERE cognito_sub = $1', ['sub-impostor']);
      expect(impostor.rowCount).toBe(0);
      expect(before).toContain(membershipOf(householdId, victim.id, 'primary'));
    });

    it('the same email conflict also blocks createHousehold and joinHousehold for the impostor', async () => {
      const victim = await createUser('sub-victim', 'shared@example.test');
      await seedHousehold(victim, 'AAA234');
      const before = await memberships();

      await expect(
        createCreateHouseholdHandler({ getPool: async () => pool })(
          event({ name: 'Mine' }, 'sub-impostor', 'createHousehold', 'shared@example.test'),
        ),
      ).rejects.toThrow(ConflictError);
      await expect(
        createJoinHouseholdHandler(deps)(event({ inviteCode: 'AAA234' }, 'sub-impostor', 'joinHousehold', 'shared@example.test')),
      ).rejects.toThrow(ConflictError);

      expect(await memberships()).toEqual(before);
    });
  });

  describe('createHousehold', () => {
    it('adds exactly one membership: the caller as primary of the household it created', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      const created = await createCreateHouseholdHandler({ getPool: async () => pool })(
        event({ name: 'Bob House' }, 'sub-bob', 'createHousehold'),
      );

      const newRows = added(before, await memberships());
      expect(newRows).toHaveLength(1);
      const [row] = newRows;
      expect(row).toMatch(new RegExp(`^${created.id}:[0-9a-f-]+:primary$`));
      expect(await memberships()).toEqual(expect.arrayContaining(before));
    });

    it('a retry returns the same household and adds no further membership', async () => {
      const handler = createCreateHouseholdHandler({ getPool: async () => pool });
      const first = await handler(event({ name: 'Retry House' }, 'sub-bob', 'createHousehold'));
      const afterFirst = await memberships();

      const second = await handler(event({ name: 'Retry House' }, 'sub-bob', 'createHousehold'));

      expect(second.id).toBe(first.id);
      expect(await memberships()).toEqual(afterFirst);
    });

    it('an invite-code collision retries into the new household only, never the colliding one', async () => {
      const alice = await createUser('sub-alice');
      const aliceHousehold = await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      const created = await createCreateHouseholdHandler({
        getPool: async () => pool,
        randomInt: codeSequence(['AAA234', 'BBB234']),
      })(event({ name: 'Collider' }, 'sub-bob', 'createHousehold'));

      expect(created.inviteCode).toBe('BBB234');
      const newRows = added(before, await memberships());
      expect(newRows).toHaveLength(1);
      expect(newRows[0]).toMatch(new RegExp(`^${created.id}:`));
      expect((await memberships()).filter((row) => row.startsWith(`${aliceHousehold}:`))).toEqual(
        before.filter((row) => row.startsWith(`${aliceHousehold}:`)),
      );
    });

    it('a failure part-way through (here: settings insert) leaves no membership behind', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      await expect(
        createCreateHouseholdHandler({
          getPool: async () => pool,
          insertDefaultSettings: async () => {
            throw new Error('forced failure');
          },
        })(event({ name: 'Doomed' }, 'sub-bob', 'createHousehold')),
      ).rejects.toThrow('forced failure');

      expect(await memberships()).toEqual(before);
    });

    it('exhausted invite-code retries leave no membership behind', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      await expect(
        createCreateHouseholdHandler({
          getPool: async () => pool,
          randomInt: codeSequence(Array.from({ length: 5 }, () => 'AAA234')),
        })(event({ name: 'Never' }, 'sub-bob', 'createHousehold')),
      ).rejects.toThrow();

      expect(await memberships()).toEqual(before);
    });
  });

  describe('joinHousehold', () => {
    it('a valid code adds exactly one membership: the caller as member of that household only', async () => {
      const alice = await createUser('sub-alice');
      const target = await seedHousehold(alice, 'AAA234');
      const otherOwner = await createUser('sub-carol');
      await seedHousehold(otherOwner, 'CCC234');
      const bob = await createUser('sub-bob');
      const before = await memberships();

      await createJoinHouseholdHandler(deps)(event({ inviteCode: 'AAA234' }, 'sub-bob', 'joinHousehold'));

      expect(added(before, await memberships())).toEqual([membershipOf(target, bob.id, 'member')]);
    });

    it('repeating the join (client retry) adds nothing further', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      await createUser('sub-bob');
      const handler = createJoinHouseholdHandler(deps);
      await handler(event({ inviteCode: 'AAA234' }, 'sub-bob', 'joinHousehold'));
      const afterFirst = await memberships();

      await handler(event({ inviteCode: 'AAA234' }, 'sub-bob', 'joinHousehold'));

      expect(await memberships()).toEqual(afterFirst);
    });

    it('an unknown code adds nothing', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      await expect(
        createJoinHouseholdHandler(deps)(event({ inviteCode: 'ZZZ234' }, 'sub-bob', 'joinHousehold')),
      ).rejects.toThrow(NotFoundError);

      expect(await memberships()).toEqual(before);
    });

    it('a full household adds nothing', async () => {
      const alice = await createUser('sub-alice');
      const members = await Promise.all(
        Array.from({ length: HOUSEHOLD_MEMBER_CAP - 1 }, (_, index) => createUser(`sub-m${index}`)),
      );
      await seedHousehold(alice, 'AAA234', members);
      const before = await memberships();

      await expect(
        createJoinHouseholdHandler(deps)(event({ inviteCode: 'AAA234' }, 'sub-bob', 'joinHousehold')),
      ).rejects.toThrow(HouseholdFullError);

      expect(await memberships()).toEqual(before);
    });

    it('a failure during the insert adds nothing', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      await expect(
        createJoinHouseholdHandler({
          ...deps,
          insertMembershipWithinCap: async () => {
            throw new Error('forced failure');
          },
        })(event({ inviteCode: 'AAA234' }, 'sub-bob', 'joinHousehold')),
      ).rejects.toThrow('forced failure');

      expect(await memberships()).toEqual(before);
    });

    it('a malformed code adds nothing', async () => {
      const alice = await createUser('sub-alice');
      await seedHousehold(alice, 'AAA234');
      const before = await memberships();

      await expect(createJoinHouseholdHandler(deps)(event({ inviteCode: '' }, 'sub-bob', 'joinHousehold'))).rejects.toThrow();

      expect(await memberships()).toEqual(before);
    });
  });

  describe('invite-code rotation and its retries', () => {
    it('rotating (including a collision and a same-code retry) adds no membership and a stale code no longer joins', async () => {
      const alice = await createUser('sub-alice');
      const aliceHousehold = await seedHousehold(alice, 'AAA234');
      const carol = await createUser('sub-carol');
      await seedHousehold(carol, 'CCC234');
      await createUser('sub-bob');
      const before = await memberships();

      const rotated = await createRotateInviteCodeHandler({
        ...deps,
        // Same as the current code, then another household's code, then a fresh one.
        randomInt: codeSequence(['AAA234', 'CCC234', 'DDD234']),
      })(event({ householdId: aliceHousehold }, 'sub-alice', 'rotateInviteCode'));

      expect(rotated.inviteCode).toBe('DDD234');
      expect(await memberships()).toEqual(before);
      await expect(
        createJoinHouseholdHandler(deps)(event({ inviteCode: 'AAA234' }, 'sub-bob', 'joinHousehold')),
      ).rejects.toThrow(NotFoundError);
      expect(await memberships()).toEqual(before);
    });

    it('a non-member cannot rotate another household code, and nothing changes', async () => {
      const alice = await createUser('sub-alice');
      const aliceHousehold = await seedHousehold(alice, 'AAA234');
      await createUser('sub-bob');
      const before = await memberships();

      await expect(
        createRotateInviteCodeHandler(deps)(event({ householdId: aliceHousehold }, 'sub-bob', 'rotateInviteCode')),
      ).rejects.toThrow(ForbiddenError);

      expect(await memberships()).toEqual(before);
      const code = await db.adminClient.query<{ invite_code: string }>('SELECT invite_code FROM households WHERE id = $1', [
        aliceHousehold,
      ]);
      expect(code.rows[0]?.invite_code).toBe('AAA234');
    });
  });
});
