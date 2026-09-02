import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createMenu } from '../repositories/menuRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createMenuHandler } from './menu.js';
import type { MenuResolverDeps } from './menu.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  householdId: unknown,
  weekStartDate: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; weekStartDate: unknown }> => ({
  arguments: { householdId, weekStartDate },
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
          weekStartDate: unknown;
        }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'weekStartDate', 'items'],
    selectionSetGraphQL: '{ id weekStartDate items { id } }',
    parentTypeName: 'Query',
    fieldName: 'menu',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('menu resolver (Query.menu)', () => {
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

  const baseDeps: MenuResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-mq-owner-noidentity');
    const householdId = await createHouseholdWithMembers(owner, 'MQN234');

    const handler = createMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, '2026-09-07T00:00:00.000Z', null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid', '2026-09-07T00:00:00.000Z'],
    ['malformed weekStartDate', undefined, '2026-09-07'],
  ])('rejects invalid input (%s) with ValidationError', async (_label, householdId, weekStartDate) => {
    const handler = createMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, weekStartDate, 'sub-mq-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-mq-owner-denial');
    const householdId = await createHouseholdWithMembers(owner, 'MQD234');
    await createUser('sub-mq-stranger-denial');

    const handler = createMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-mq-stranger-denial')),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      handler(buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-mq-stranger-denial')),
    ).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-mq-oracle-probe');
    const handler = createMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(randomUUID(), '2026-09-07T00:00:00.000Z', 'sub-mq-oracle-probe')),
    ).rejects.toThrow(ForbiddenError);
  });

  it('returns null for a week with no menu yet, without creating one', async () => {
    const owner = await createUser('sub-mq-owner-nomenu');
    const householdId = await createHouseholdWithMembers(owner, 'MQE234');

    const handler = createMenuHandler(baseDeps);
    const result = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-mq-owner-nomenu'),
    );

    expect(result).toBeNull();
    const countResult = await db.adminClient.query('SELECT 1 FROM menus WHERE household_id = $1', [
      householdId,
    ]);
    expect(countResult.rows).toHaveLength(0);
  });

  it('returns the existing menu for a week that has one', async () => {
    const owner = await createUser('sub-mq-owner-existing');
    const householdId = await createHouseholdWithMembers(owner, 'MQX234');
    await withUserTransaction(owner.id, (client) => createMenu(client, householdId, '2026-09-07'), pool);

    const handler = createMenuHandler(baseDeps);
    const result = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-mq-owner-existing'),
    );

    expect(result).not.toBeNull();
    expect(result?.weekStartDate).toBe('2026-09-07T00:00:00.000Z');
  });

  it("only ever returns the caller's OWN household's menu — a non-member of THIS household but member of another gets denied, not the wrong menu", async () => {
    const ownerA = await createUser('sub-mq-owner-a');
    const ownerB = await createUser('sub-mq-owner-b');
    const householdA = await createHouseholdWithMembers(ownerA, 'MQA234');
    await createHouseholdWithMembers(ownerB, 'MQB234');
    await withUserTransaction(ownerA.id, (client) => createMenu(client, householdA, '2026-09-07'), pool);

    const handler = createMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdA, '2026-09-07T00:00:00.000Z', 'sub-mq-owner-b')),
    ).rejects.toThrow(ForbiddenError);
  });
});
