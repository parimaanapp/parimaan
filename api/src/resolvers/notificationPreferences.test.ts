import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { upsertNotificationPreferencesPartial } from '../repositories/notificationPreferencesRepository.js';
import { createNotificationPreferencesHandler } from './notificationPreferences.js';
import type { NotificationPreferencesResolverDeps } from './notificationPreferences.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

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
    selectionSetList: ['householdId', 'listChanges', 'mealReminder', 'expiry', 'activity'],
    selectionSetGraphQL: '{ householdId listChanges mealReminder expiry activity }',
    parentTypeName: 'Query',
    fieldName: 'notificationPreferences',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('notificationPreferences resolver (Query.notificationPreferences)', () => {
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

  const baseDeps: NotificationPreferencesResolverDeps = { getPool: async () => pool };

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
          await insertMembership(client, { householdId: household.id, userId: member.id, role: 'member' });
        }
        return household.id;
      },
      pool,
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-npref-owner-noidentity');
    const householdId = await createHouseholdWithMembers(owner, 'NPN234');

    const handler = createNotificationPreferencesHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createNotificationPreferencesHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-npref-validation'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-npref-owner-denial');
    const householdId = await createHouseholdWithMembers(owner, 'NPD234');
    await createUser('sub-npref-stranger-denial');

    const handler = createNotificationPreferencesHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-npref-stranger-denial'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(householdId, 'sub-npref-stranger-denial'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-npref-oracle-probe');
    const handler = createNotificationPreferencesHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-npref-oracle-probe'))).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('returns the SD-specified TRUE defaults for a member with no row yet, without writing one', async () => {
    const owner = await createUser('sub-npref-owner-defaults');
    const householdId = await createHouseholdWithMembers(owner, 'NPF234');

    const handler = createNotificationPreferencesHandler(baseDeps);
    const result = await handler(buildEvent(householdId, 'sub-npref-owner-defaults'));

    expect(result).toEqual({
      householdId,
      listChanges: true,
      mealReminder: true,
      expiry: true,
      activity: true,
    });

    const countResult = await db.adminClient.query('SELECT 1 FROM notification_preferences');
    expect(countResult.rows).toHaveLength(0);
  });

  it('returns a saved row once one exists, reflecting non-default values', async () => {
    const owner = await createUser('sub-npref-owner-saved');
    const householdId = await createHouseholdWithMembers(owner, 'NPS234');
    await withUserTransaction(
      owner.id,
      (client) =>
        upsertNotificationPreferencesPartial(client, owner.id, householdId, {
          listChanges: false,
          activity: false,
        }),
      pool,
    );

    const handler = createNotificationPreferencesHandler(baseDeps);
    const result = await handler(buildEvent(householdId, 'sub-npref-owner-saved'));

    expect(result).toEqual({
      householdId,
      listChanges: false,
      mealReminder: true,
      expiry: true,
      activity: false,
    });
  });

  it("only ever returns the CALLER's own row, never a fellow member's", async () => {
    const owner = await createUser('sub-npref-owner-isolated');
    const member = await createUser('sub-npref-member-isolated');
    const householdId = await createHouseholdWithMembers(owner, 'NPI234', [member]);
    await withUserTransaction(
      owner.id,
      (client) => upsertNotificationPreferencesPartial(client, owner.id, householdId, { listChanges: false }),
      pool,
    );

    const handler = createNotificationPreferencesHandler(baseDeps);
    const memberResult = await handler(buildEvent(householdId, 'sub-npref-member-isolated'));

    // member has no row of their own yet — must get the defaults, not the
    // owner's saved (and differing) listChanges: false.
    expect(memberResult.listChanges).toBe(true);
  });
});
