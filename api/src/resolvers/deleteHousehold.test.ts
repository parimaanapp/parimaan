import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import {
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  insertMembershipWithinCap,
} from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createDeleteHouseholdHandler } from './deleteHousehold.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

/** The exact message `auth/requireHouseholdMember.ts` denies with — asserted verbatim, never re-worded here. */
const DENIAL_MESSAGE = 'You are not a member of this household.';

const HOUSEHOLD_NAME = 'The Sharma House';

const buildEvent = (
  householdId: unknown,
  confirmationName: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; confirmationName: unknown }> => ({
  arguments: { householdId, confirmationName },
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
        } as unknown as AppSyncResolverEvent<{
          householdId: unknown;
          confirmationName: unknown;
        }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'deleteHousehold',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('deleteHousehold resolver', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const handler = createDeleteHouseholdHandler({ getPool: async () => pool });

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
          name: HOUSEHOLD_NAME,
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

  const householdExists = async (householdId: string): Promise<boolean> => {
    const result = await pool.query('SELECT 1 FROM households WHERE id = $1', [householdId]);
    return result.rows.length === 1;
  };

  // --- 1. identity + validation ---

  it('rejects a null identity with UnauthorizedError, leaving the household intact', async () => {
    const owner = await createUser('sub-owner-delnoid');
    const householdId = await createHouseholdWithMembers(owner, 'DNI234');

    await expect(handler(buildEvent(householdId, HOUSEHOLD_NAME, null))).rejects.toThrow(
      UnauthorizedError,
    );
    expect(await householdExists(householdId)).toBe(true);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    await expect(
      handler(buildEvent(householdId, HOUSEHOLD_NAME, 'sub-validation-delete')),
    ).rejects.toThrow(ValidationError);
  });

  // --- 2. authorization ---

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-delstranger');
    const householdId = await createHouseholdWithMembers(owner, 'DST234');
    await createUser('sub-stranger-delete');

    await expect(
      handler(buildEvent(householdId, HOUSEHOLD_NAME, 'sub-stranger-delete')),
    ).rejects.toThrow(DENIAL_MESSAGE);
    expect(await householdExists(householdId)).toBe(true);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-delete');
    await expect(
      handler(buildEvent(randomUUID(), HOUSEHOLD_NAME, 'sub-oracle-delete')),
    ).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('denies a non-primary member with ForbiddenError, leaving the household intact', async () => {
    const owner = await createUser('sub-owner-delmember');
    const member = await createUser('sub-member-delmember');
    const householdId = await createHouseholdWithMembers(owner, 'DMB234', [member]);

    await expect(
      handler(buildEvent(householdId, HOUSEHOLD_NAME, 'sub-member-delmember')),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      handler(buildEvent(householdId, HOUSEHOLD_NAME, 'sub-member-delmember')),
    ).rejects.toThrow(/Only the primary member/);
    expect(await householdExists(householdId)).toBe(true);
  });

  // --- 3. the confirmation gate ---

  it.each([
    ['a wrong name', 'Some Other House'],
    ['a case difference', 'the sharma house'],
    ['trailing whitespace', `${HOUSEHOLD_NAME} `],
    ['leading whitespace', ` ${HOUSEHOLD_NAME}`],
  ])(
    'rejects %s with ValidationError and does NOT delete the household',
    async (_label, confirmationName) => {
      const owner = await createUser(`sub-owner-confirm-${_label.replace(/\s/g, '')}`);
      const householdId = await createHouseholdWithMembers(owner, 'CNF234');

      await expect(
        handler(buildEvent(householdId, confirmationName, owner.cognitoSub)),
      ).rejects.toThrow(ValidationError);
      await expect(
        handler(buildEvent(householdId, confirmationName, owner.cognitoSub)),
      ).rejects.toThrow(/exactly match/);

      expect(await householdExists(householdId)).toBe(true);
      const memberships = await pool.query(
        'SELECT 1 FROM household_memberships WHERE household_id = $1',
        [householdId],
      );
      expect(memberships.rows).toHaveLength(1);
    },
  );

  // --- 4. happy path ---

  it('deletes the household, its memberships, and its settings when the primary confirms the exact name', async () => {
    const owner = await createUser('sub-owner-delhappy');
    const member = await createUser('sub-member-delhappy');
    const householdId = await createHouseholdWithMembers(owner, 'DHP234', [member]);

    await expect(handler(buildEvent(householdId, HOUSEHOLD_NAME, 'sub-owner-delhappy'))).resolves.toBe(
      true,
    );

    expect(await householdExists(householdId)).toBe(false);
    const memberships = await pool.query(
      'SELECT 1 FROM household_memberships WHERE household_id = $1',
      [householdId],
    );
    expect(memberships.rows).toHaveLength(0);
    // Read as the superuser: RLS would hide a surviving settings row from the
    // app role, making this pass for the wrong reason.
    const settings = await db.adminClient.query(
      'SELECT 1 FROM household_settings WHERE household_id = $1',
      [householdId],
    );
    expect(settings.rows).toHaveLength(0);
    // The users themselves are untouched — only the household is destroyed.
    const users = await pool.query('SELECT 1 FROM users WHERE id = ANY($1::uuid[])', [
      [owner.id, member.id],
    ]);
    expect(users.rows).toHaveLength(2);
  });

  it("leaves another household completely intact", async () => {
    const ownerA = await createUser('sub-owner-cross-del-a');
    const ownerB = await createUser('sub-owner-cross-del-b');
    const householdAId = await createHouseholdWithMembers(ownerA, 'CDA234');
    const householdBId = await createHouseholdWithMembers(ownerB, 'CDB234');

    await handler(buildEvent(householdAId, HOUSEHOLD_NAME, 'sub-owner-cross-del-a'));

    expect(await householdExists(householdBId)).toBe(true);
    const memberships = await pool.query(
      'SELECT 1 FROM household_memberships WHERE household_id = $1',
      [householdBId],
    );
    expect(memberships.rows).toHaveLength(1);
  });
});
