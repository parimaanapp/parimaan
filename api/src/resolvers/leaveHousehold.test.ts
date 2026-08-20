import { randomUUID } from 'node:crypto';
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
  findSettingsForHousehold,
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  insertMembershipWithinCap,
} from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { HOUSEHOLD_MEMBER_CAP } from '../domain/householdLimits.js';
import { createLeaveHouseholdHandler } from './leaveHousehold.js';
import { createJoinHouseholdHandler } from './joinHousehold.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const buildEvent = (
  householdId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown }> => ({
  arguments: { householdId },
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
        } as unknown as AppSyncResolverEvent<{ householdId: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'leaveHousehold',
    variables: {},
  },
  prev: null,
  stash: {},
});

const buildJoinEvent = (
  inviteCode: string,
  cognitoSub: string,
): AppSyncResolverEvent<{ inviteCode: unknown }> => {
  const event = buildEvent(inviteCode, cognitoSub) as unknown as AppSyncResolverEvent<{
    inviteCode: unknown;
  }>;
  return { ...event, arguments: { inviteCode }, info: { ...event.info, fieldName: 'joinHousehold' } };
};

describe('leaveHousehold resolver', () => {
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

  const leaveHandler = createLeaveHouseholdHandler({ getPool: async () => pool });
  const joinHandler = (): ReturnType<typeof createJoinHouseholdHandler> =>
    createJoinHouseholdHandler({
      getPool: async () => pool,
      getDdbClient: () => ddb.client,
      getCacheTableName: () => ddb.tableName,
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
        await insertMembership(client, {
          householdId: household.id,
          userId: owner.id,
          role: 'primary',
        });
        await insertDefaultSettings(client, household.id);
        for (const member of extraMembers) {
          await insertMembershipWithinCap(
            client,
            { householdId: household.id, userId: member.id, role: 'member' },
            99,
          );
        }
        return household.id;
      },
      pool,
    );

  const membershipCount = async (householdId: string): Promise<number> => {
    const result = await pool.query(
      'SELECT count(*)::int AS n FROM household_memberships WHERE household_id = $1',
      [householdId],
    );
    return result.rows[0].n as number;
  };

  // --- 1. identity + validation ---

  it('rejects a null identity with UnauthorizedError', async () => {
    await expect(leaveHandler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    await expect(leaveHandler(buildEvent(householdId, 'sub-validation-leave'))).rejects.toThrow(
      ValidationError,
    );
  });

  // --- 2. happy path ---

  it('lets a non-primary member leave: returns true, removes only their row, leaves settings alone', async () => {
    const owner = await createUser('sub-owner-leave');
    const leaver = await createUser('sub-leaver-leave');
    const stayer = await createUser('sub-stayer-leave');
    const householdId = await createHouseholdWithMembers(owner, 'LVH234', [leaver, stayer]);

    const settingsBefore = await withUserTransaction(
      owner.id,
      (client) => findSettingsForHousehold(client, householdId),
      pool,
    );

    await expect(leaveHandler(buildEvent(householdId, 'sub-leaver-leave'))).resolves.toBe(true);

    const gone = await withUserTransaction(
      owner.id,
      (client) => findMembership(client, householdId, leaver.id),
      pool,
    );
    expect(gone).toBeNull();

    const stayerRow = await withUserTransaction(
      owner.id,
      (client) => findMembership(client, householdId, stayer.id),
      pool,
    );
    expect(stayerRow).toMatchObject({ userId: stayer.id, role: 'member' });
    expect(await membershipCount(householdId)).toBe(2);

    const settingsAfter = await withUserTransaction(
      owner.id,
      (client) => findSettingsForHousehold(client, householdId),
      pool,
    );
    expect(settingsAfter).toEqual(settingsBefore);
  });

  // --- 3. the primary may not leave ---

  it('refuses the primary with ForbiddenError, and their membership row survives intact', async () => {
    const owner = await createUser('sub-owner-primaryleave');
    const householdId = await createHouseholdWithMembers(owner, 'PLV234');

    await expect(leaveHandler(buildEvent(householdId, 'sub-owner-primaryleave'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(leaveHandler(buildEvent(householdId, 'sub-owner-primaryleave'))).rejects.toThrow(
      /primary member cannot leave/i,
    );

    const stillThere = await withUserTransaction(
      owner.id,
      (client) => findMembership(client, householdId, owner.id),
      pool,
    );
    expect(stillThere).toMatchObject({ userId: owner.id, role: 'primary' });
    expect(await membershipCount(householdId)).toBe(1);
  });

  // --- 4. idempotency + non-oracle behavior ---

  it('is idempotent: leaving twice returns true both times', async () => {
    const owner = await createUser('sub-owner-twice');
    const leaver = await createUser('sub-leaver-twice');
    const householdId = await createHouseholdWithMembers(owner, 'TWC234', [leaver]);

    await expect(leaveHandler(buildEvent(householdId, 'sub-leaver-twice'))).resolves.toBe(true);
    await expect(leaveHandler(buildEvent(householdId, 'sub-leaver-twice'))).resolves.toBe(true);
    expect(await membershipCount(householdId)).toBe(1);
  });

  it('returns true for a household the caller never joined', async () => {
    const owner = await createUser('sub-owner-neverjoined');
    const householdId = await createHouseholdWithMembers(owner, 'NVR234');
    await createUser('sub-stranger-neverjoined');

    await expect(leaveHandler(buildEvent(householdId, 'sub-stranger-neverjoined'))).resolves.toBe(
      true,
    );
    expect(await membershipCount(householdId)).toBe(1);
  });

  it('returns an indistinguishable true for a nonexistent household and for an already-left one', async () => {
    const owner = await createUser('sub-owner-indistinguishable');
    const leaver = await createUser('sub-leaver-indistinguishable');
    const householdId = await createHouseholdWithMembers(owner, 'IND234', [leaver]);

    await leaveHandler(buildEvent(householdId, 'sub-leaver-indistinguishable'));
    const alreadyLeft = await leaveHandler(buildEvent(householdId, 'sub-leaver-indistinguishable'));
    const nonexistent = await leaveHandler(buildEvent(randomUUID(), 'sub-leaver-indistinguishable'));

    // Same value, no error, no way to tell the two situations apart — this
    // mutation is deliberately not a household-existence oracle.
    expect(nonexistent).toBe(alreadyLeft);
    expect(nonexistent).toBe(true);
  });

  // --- 5. layer-3 regression: RLS follows the membership deletion ---

  it("RLS follows the deletion: an ex-member's own scoped read of household_settings returns null afterwards", async () => {
    const owner = await createUser('sub-owner-rls');
    const leaver = await createUser('sub-leaver-rls');
    const householdId = await createHouseholdWithMembers(owner, 'RLV234', [leaver]);

    const before = await withUserTransaction(
      leaver.id,
      (client) => findSettingsForHousehold(client, householdId),
      pool,
    );
    expect(before).toMatchObject({ householdId });

    await leaveHandler(buildEvent(householdId, 'sub-leaver-rls'));

    const after = await withUserTransaction(
      leaver.id,
      (client) => findSettingsForHousehold(client, householdId),
      pool,
    );
    expect(after).toBeNull();
  });

  // --- 6. interaction with the member cap ---

  it('frees a cap slot: a full household accepts a brand-new member after one leaves', async () => {
    const owner = await createUser('sub-owner-capfree');
    const fillers = await Promise.all(
      Array.from({ length: HOUSEHOLD_MEMBER_CAP - 1 }, (_, i) => createUser(`sub-filler-${i}`)),
    );
    const householdId = await createHouseholdWithMembers(owner, 'CPF234', fillers);
    expect(await membershipCount(householdId)).toBe(HOUSEHOLD_MEMBER_CAP);

    await expect(leaveHandler(buildEvent(householdId, 'sub-filler-0'))).resolves.toBe(true);
    expect(await membershipCount(householdId)).toBe(HOUSEHOLD_MEMBER_CAP - 1);

    const joined = await joinHandler()(buildJoinEvent('CPF234', 'sub-sixth-capfree'));
    expect(joined.id).toBe(householdId);
    expect(await membershipCount(householdId)).toBe(HOUSEHOLD_MEMBER_CAP);
  });

  // --- 7. leave then rejoin ---

  it('leave-then-rejoin comes back as role `member`, never re-promoted to primary', async () => {
    const owner = await createUser('sub-owner-rejoin');
    const leaver = await createUser('sub-leaver-rejoin');
    const householdId = await createHouseholdWithMembers(owner, 'RJN234', [leaver]);

    await leaveHandler(buildEvent(householdId, 'sub-leaver-rejoin'));
    await joinHandler()(buildJoinEvent('RJN234', 'sub-leaver-rejoin'));

    const rejoined = await withUserTransaction(
      leaver.id,
      (client) => findMembership(client, householdId, leaver.id),
      pool,
    );
    expect(rejoined).toMatchObject({ userId: leaver.id, role: 'member' });

    const primaryRow = await pool.query('SELECT primary_user_id FROM households WHERE id = $1', [
      householdId,
    ]);
    expect(primaryRow.rows[0].primary_user_id).toBe(owner.id);
  });

  // --- 8. lost race ---

  it('still returns true when the delete finds nothing (a concurrent leave won the race)', async () => {
    const owner = await createUser('sub-owner-lostrace');
    const leaver = await createUser('sub-leaver-lostrace');
    const householdId = await createHouseholdWithMembers(owner, 'LST234', [leaver]);

    const handler = createLeaveHouseholdHandler({
      getPool: async () => pool,
      // Forces the exact outcome of a concurrent leave landing between the
      // pre-check and the delete: the row is already gone.
      deleteNonPrimaryMembership: async () => null,
    });

    await expect(handler(buildEvent(householdId, 'sub-leaver-lostrace'))).resolves.toBe(true);
  });
});
