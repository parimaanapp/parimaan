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
import { findNotificationPreferences } from '../repositories/notificationPreferencesRepository.js';
import { createUpdateNotificationPreferencesHandler } from './updateNotificationPreferences.js';
import type { UpdateNotificationPreferencesResolverDeps } from './updateNotificationPreferences.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  householdId: unknown,
  input: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; input: unknown }> => ({
  arguments: { householdId, input },
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
        } as unknown as AppSyncResolverEvent<{ householdId: unknown; input: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['householdId', 'listChanges', 'mealReminder', 'expiry', 'activity'],
    selectionSetGraphQL: '{ householdId listChanges mealReminder expiry activity }',
    parentTypeName: 'Mutation',
    fieldName: 'updateNotificationPreferences',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('updateNotificationPreferences resolver (Mutation.updateNotificationPreferences)', () => {
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

  const baseDeps: UpdateNotificationPreferencesResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-unpref-owner-noidentity');
    const householdId = await createHouseholdWithMembers(owner, 'UNI234');

    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, { listChanges: false }, null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, { listChanges: false }, 'sub-unpref-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an empty patch (every field absent) with ValidationError', async () => {
    const owner = await createUser('sub-unpref-owner-empty');
    const householdId = await createHouseholdWithMembers(owner, 'UNE234');

    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    await expect(handler(buildEvent(householdId, {}, 'sub-unpref-owner-empty'))).rejects.toThrow(
      ValidationError,
    );
  });

  it.each(['listChanges', 'mealReminder', 'expiry', 'activity'])(
    'rejects an explicit null for %s with ValidationError — not a supported "clear this field" operation',
    async (field) => {
      const owner = await createUser(`sub-unpref-owner-null-${field}`);
      const householdId = await createHouseholdWithMembers(owner, `UNN${field.slice(0, 3).toUpperCase()}`);

      const handler = createUpdateNotificationPreferencesHandler(baseDeps);
      await expect(
        handler(buildEvent(householdId, { [field]: null }, `sub-unpref-owner-null-${field}`)),
      ).rejects.toThrow(ValidationError);
    },
  );

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-unpref-owner-denial');
    const householdId = await createHouseholdWithMembers(owner, 'UND234');
    await createUser('sub-unpref-stranger-denial');

    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, { listChanges: false }, 'sub-unpref-stranger-denial')),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      handler(buildEvent(householdId, { listChanges: false }, 'sub-unpref-stranger-denial')),
    ).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-unpref-oracle-probe');
    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    await expect(
      handler(buildEvent(randomUUID(), { listChanges: false }, 'sub-unpref-oracle-probe')),
    ).rejects.toThrow(ForbiddenError);
  });

  it('the first patch for a (caller, household) pair materialises the row, defaulting every other field to TRUE', async () => {
    const owner = await createUser('sub-unpref-owner-first');
    const householdId = await createHouseholdWithMembers(owner, 'UNF234');

    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    const result = await handler(buildEvent(householdId, { listChanges: false }, 'sub-unpref-owner-first'));

    expect(result).toEqual({
      householdId,
      listChanges: false,
      mealReminder: true,
      expiry: true,
      activity: true,
    });
  });

  it('a second patch is a genuine partial update — fields absent from THIS patch keep their previously-saved value, not the TRUE default', async () => {
    const owner = await createUser('sub-unpref-owner-second');
    const householdId = await createHouseholdWithMembers(owner, 'UNS234');
    const handler = createUpdateNotificationPreferencesHandler(baseDeps);
    await handler(buildEvent(householdId, { listChanges: false, activity: false }, 'sub-unpref-owner-second'));

    const result = await handler(buildEvent(householdId, { mealReminder: false }, 'sub-unpref-owner-second'));

    expect(result).toEqual({
      householdId,
      listChanges: false,
      mealReminder: false,
      expiry: true,
      activity: false,
    });
  });

  it("writes to the CALLER's own row only, never a fellow member's — even when both patch the same household", async () => {
    const owner = await createUser('sub-unpref-owner-isolated');
    const member = await createUser('sub-unpref-member-isolated');
    const householdId = await createHouseholdWithMembers(owner, 'UNW234', [member]);
    const handler = createUpdateNotificationPreferencesHandler(baseDeps);

    await handler(buildEvent(householdId, { listChanges: false }, 'sub-unpref-owner-isolated'));
    await handler(buildEvent(householdId, { activity: false }, 'sub-unpref-member-isolated'));

    const ownerRow = await withUserTransaction(
      owner.id,
      (client) => findNotificationPreferences(client, owner.id, householdId),
      pool,
    );
    const memberRow = await withUserTransaction(
      member.id,
      (client) => findNotificationPreferences(client, member.id, householdId),
      pool,
    );

    expect(ownerRow?.listChanges).toBe(false);
    expect(ownerRow?.activity).toBe(true);
    expect(memberRow?.listChanges).toBe(true);
    expect(memberRow?.activity).toBe(false);
  });
});
