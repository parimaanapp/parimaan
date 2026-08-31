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
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  insertMembershipWithinCap,
} from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { INVITE_CODE_ALPHABET } from '../domain/inviteCode.js';
import type { RandomIntFn } from '../domain/inviteCode.js';
import { MAX_INVITE_CODE_ATTEMPTS } from '../domain/inviteCodeAttempts.js';
import { createRotateInviteCodeHandler, MAX_ROTATE_ATTEMPTS_PER_DAY } from './rotateInviteCode.js';
import type { RotateInviteCodeResolverDeps } from './rotateInviteCode.js';
import { createJoinHouseholdHandler } from './joinHousehold.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';

/** The exact message `auth/requireHouseholdMember.ts` denies with — asserted verbatim, never re-worded here. */
const DENIAL_MESSAGE = 'You are not a member of this household.';

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
    fieldName: 'rotateInviteCode',
    variables: {},
  },
  prev: null,
  stash: {},
});

/** The same event shape, re-labelled for the real `joinHousehold` handler these tests drive end-to-end. */
const buildJoinEvent = (
  inviteCode: string,
  cognitoSub: string,
): AppSyncResolverEvent<{ inviteCode: unknown }> => {
  const event = buildEvent(inviteCode, cognitoSub) as unknown as AppSyncResolverEvent<{
    inviteCode: unknown;
  }>;
  return { ...event, arguments: { inviteCode }, info: { ...event.info, fieldName: 'joinHousehold' } };
};

/**
 * A deterministic `RandomIntFn` emitting exactly `codes`, in order, plus a
 * live count of how many complete codes have been minted — that count is what
 * the "regenerates once more on a same-code draw" test actually asserts on.
 */
const stubCodes = (codes: readonly string[]): { randomInt: RandomIntFn; generated: () => number } => {
  let call = 0;
  return {
    randomInt: (): number => {
      const code = codes[Math.floor(call / 6)];
      const char = code?.[call % 6];
      call += 1;
      if (char === undefined) {
        throw new Error('ran out of stubbed invite codes');
      }
      return INVITE_CODE_ALPHABET.indexOf(char);
    },
    generated: (): number => Math.ceil(call / 6),
  };
};

describe('rotateInviteCode resolver', () => {
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

  const baseDeps = (
    overrides: Partial<RotateInviteCodeResolverDeps> = {},
  ): RotateInviteCodeResolverDeps => ({
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

  const readInviteCode = async (householdId: string): Promise<string> => {
    const result = await pool.query('SELECT invite_code FROM households WHERE id = $1', [
      householdId,
    ]);
    return result.rows[0].invite_code as string;
  };

  // --- 1. identity + validation ---

  it('rejects a null identity with UnauthorizedError, leaving the invite code unchanged', async () => {
    const owner = await createUser('sub-owner-noidentity');
    const householdId = await createHouseholdWithMembers(owner, 'NID234');

    const handler = createRotateInviteCodeHandler(baseDeps());
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
    expect(await readInviteCode(householdId)).toBe('NID234');
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createRotateInviteCodeHandler(baseDeps());
    await expect(handler(buildEvent(householdId, 'sub-validation-rotate'))).rejects.toThrow(
      ValidationError,
    );
  });

  // --- 2. authorization ---

  it('denies a non-member with the exact requireHouseholdMember denial message, leaving the code unchanged', async () => {
    const owner = await createUser('sub-owner-denial');
    const householdId = await createHouseholdWithMembers(owner, 'DEN234');
    await createUser('sub-stranger-denial');

    const handler = createRotateInviteCodeHandler(baseDeps());
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
    expect(await readInviteCode(householdId)).toBe('DEN234');
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe');
    const handler = createRotateInviteCodeHandler(baseDeps());
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  // --- 3. happy paths: ANY member may rotate ---

  it('lets a non-primary member rotate the code', async () => {
    const owner = await createUser('sub-owner-memberrotate');
    const member = await createUser('sub-member-memberrotate');
    const householdId = await createHouseholdWithMembers(owner, 'MBR234', [member]);

    const handler = createRotateInviteCodeHandler(baseDeps());
    const result = await handler(buildEvent(householdId, 'sub-member-memberrotate'));

    expect(result.inviteCode).not.toBe('MBR234');
    expect(result.inviteCode).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(await readInviteCode(householdId)).toBe(result.inviteCode);
  });

  it('lets the primary member rotate the code', async () => {
    const owner = await createUser('sub-owner-primaryrotate');
    const householdId = await createHouseholdWithMembers(owner, 'PRI234');

    const handler = createRotateInviteCodeHandler(baseDeps());
    const result = await handler(buildEvent(householdId, 'sub-owner-primaryrotate'));

    expect(result.inviteCode).not.toBe('PRI234');
    expect(await readInviteCode(householdId)).toBe(result.inviteCode);
  });

  // --- 4. the new code must actually differ ---

  it('regenerates once more when the minted code equals the current one — exactly 2 generation attempts', async () => {
    const owner = await createUser('sub-owner-samecode');
    const householdId = await createHouseholdWithMembers(owner, 'SAM234');
    const stub = stubCodes(['SAM234', 'NEW234']);

    const handler = createRotateInviteCodeHandler(baseDeps({ randomInt: stub.randomInt }));
    const result = await handler(buildEvent(householdId, 'sub-owner-samecode'));

    expect(result.inviteCode).toBe('NEW234');
    expect(stub.generated()).toBe(2);
  });

  // --- 5. end-to-end effect on joinHousehold ---

  it('invalidates the old code end-to-end: joining with it afterwards throws NotFoundError', async () => {
    const owner = await createUser('sub-owner-invalidate');
    const householdId = await createHouseholdWithMembers(owner, 'OLD234');

    const rotate = createRotateInviteCodeHandler(baseDeps());
    await rotate(buildEvent(householdId, 'sub-owner-invalidate'));

    const join = createJoinHouseholdHandler({
      getPool: async () => pool,
      getDdbClient: () => ddb.client,
      getCacheTableName: () => ddb.tableName,
    });
    await expect(join(buildJoinEvent('OLD234', 'sub-joiner-invalidate'))).rejects.toThrow(
      NotFoundError,
    );
  });

  it('the new code works end-to-end: joining with it succeeds', async () => {
    const owner = await createUser('sub-owner-newcode');
    const householdId = await createHouseholdWithMembers(owner, 'PRE234');

    const rotate = createRotateInviteCodeHandler(baseDeps());
    const rotated = await rotate(buildEvent(householdId, 'sub-owner-newcode'));

    const join = createJoinHouseholdHandler({
      getPool: async () => pool,
      getDdbClient: () => ddb.client,
      getCacheTableName: () => ddb.tableName,
    });
    const joined = await join(buildJoinEvent(rotated.inviteCode, 'sub-joiner-newcode'));
    expect(joined.id).toBe(householdId);
    expect(joined.members).toHaveLength(2);
  });

  // --- 6. invite-code collision retry + exhaustion ---

  it('retries on a collision with another household and succeeds with the next code', async () => {
    const otherOwner = await createUser('sub-otherowner-collision');
    await createHouseholdWithMembers(otherOwner, 'TKN234');

    const owner = await createUser('sub-owner-collision');
    const householdId = await createHouseholdWithMembers(owner, 'COL234');
    const stub = stubCodes(['TKN234', 'FRE234']);

    const handler = createRotateInviteCodeHandler(baseDeps({ randomInt: stub.randomInt }));
    const result = await handler(buildEvent(householdId, 'sub-owner-collision'));

    expect(result.inviteCode).toBe('FRE234');
    expect(await readInviteCode(householdId)).toBe('FRE234');
  });

  it(`throws after ${MAX_INVITE_CODE_ATTEMPTS} colliding attempts, leaving invite_code unchanged in the database`, async () => {
    const otherOwner = await createUser('sub-otherowner-exhaust');
    await createHouseholdWithMembers(otherOwner, '222222');

    const owner = await createUser('sub-owner-exhaust');
    const householdId = await createHouseholdWithMembers(owner, 'EXH234');

    const handler = createRotateInviteCodeHandler(baseDeps({ randomInt: () => 0 }));
    await expect(handler(buildEvent(householdId, 'sub-owner-exhaust'))).rejects.toThrow(
      /unique household invite code/,
    );
    expect(await readInviteCode(householdId)).toBe('EXH234');
  });

  // --- 7. rate limiting ---

  it(`rate-limits the caller after ${MAX_ROTATE_ATTEMPTS_PER_DAY} rotations in one UTC day, writing nothing on the rejected call`, async () => {
    const owner = await createUser('sub-owner-ratelimit-rotate');
    const householdId = await createHouseholdWithMembers(owner, 'RTE234');

    const fixedNow = (): Date => new Date('2026-08-19T10:00:00.000Z');
    const handler = createRotateInviteCodeHandler(baseDeps({ now: fixedNow }));

    for (let i = 0; i < MAX_ROTATE_ATTEMPTS_PER_DAY; i += 1) {
      await handler(buildEvent(householdId, 'sub-owner-ratelimit-rotate'));
    }
    const codeAfterBudget = await readInviteCode(householdId);

    // Asserts the exact message, not just the error type: a W7 S12 finding
    // was that this shared limiter can silently leak a *different* action's
    // rate-limit copy (e.g. joinHousehold's "Too many join attempts...")
    // onto this resolver's own cap — `instanceof`/class-only checks alone
    // would never catch that class of regression.
    await expect(handler(buildEvent(householdId, 'sub-owner-ratelimit-rotate'))).rejects.toThrow(
      `You've reached today's limit of ${MAX_ROTATE_ATTEMPTS_PER_DAY} invite code rotations. Try again tomorrow.`,
    );
    // The rejected call must never have reached the database.
    expect(await readInviteCode(householdId)).toBe(codeAfterBudget);
  });

  // --- 8. blast radius ---

  it('touches only households.invite_code — settings, primary_user_id, and membership rows are untouched', async () => {
    const owner = await createUser('sub-owner-blastradius');
    const member = await createUser('sub-member-blastradius');
    const householdId = await createHouseholdWithMembers(owner, 'BLA234', [member]);

    // Read through a member-scoped transaction: `household_settings` is
    // RLS-protected, so a bare pool query would fail the policy's
    // `current_setting('parimaan.user_id')::UUID` cast outright.
    const snapshot = (): Promise<Record<string, unknown>> =>
      withUserTransaction(
        owner.id,
        async (client) => {
          const result = await client.query(
            `SELECT h.primary_user_id, h.name, h.subscription_status,
                    (SELECT count(*)::int FROM household_memberships m WHERE m.household_id = h.id) AS members,
                    (SELECT s.updated_at FROM household_settings s WHERE s.household_id = h.id) AS settings_updated_at
             FROM households h WHERE h.id = $1`,
            [householdId],
          );
          return result.rows[0] as Record<string, unknown>;
        },
        pool,
      );

    const before = await snapshot();

    const handler = createRotateInviteCodeHandler(baseDeps());
    await handler(buildEvent(householdId, 'sub-member-blastradius'));

    const after = await snapshot();

    expect(after).toEqual(before);
    expect(after['primary_user_id']).toBe(owner.id);
    expect(after['members']).toBe(2);
  });
});
