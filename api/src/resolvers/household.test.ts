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
import { createHouseholdHandler } from './household.js';
import type { HouseholdResolverDeps } from './household.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

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
    parentTypeName: 'Query',
    fieldName: 'household',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('household resolver (Query.household)', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const baseDeps: HouseholdResolverDeps = { getPool: async () => pool };

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

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-owner-noidentity');
    const householdId = await createHouseholdWithMembers(owner, 'NID234');

    const handler = createHouseholdHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createHouseholdHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-validation-household'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-denial');
    const householdId = await createHouseholdWithMembers(owner, 'DEN234');
    await createUser('sub-stranger-denial');

    const handler = createHouseholdHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe');
    const handler = createHouseholdHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('returns the household hydrated with settings and every member for a member caller', async () => {
    const owner = await createUser('sub-owner-success');
    const member = await createUser('sub-member-success');
    const householdId = await createHouseholdWithMembers(owner, 'SUC234', [member]);

    const handler = createHouseholdHandler(baseDeps);
    const result = await handler(buildEvent(householdId, 'sub-owner-success'));

    expect(result.id).toBe(householdId);
    expect(result.inviteCode).toBe('SUC234');
    expect(result.settings).toBeDefined();
    expect(result.members).toHaveLength(2);
    const roles = result.members.map((m) => m.role).sort();
    expect(roles).toEqual(['member', 'primary']);
  });

  it('returns the household for a non-primary member too — any member can read', async () => {
    const owner = await createUser('sub-owner-member-read');
    const member = await createUser('sub-member-read');
    const householdId = await createHouseholdWithMembers(owner, 'MRD234', [member]);

    const handler = createHouseholdHandler(baseDeps);
    const result = await handler(buildEvent(householdId, 'sub-member-read'));

    expect(result.id).toBe(householdId);
  });
});
