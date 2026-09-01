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
} from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createOnHouseholdChangedHandler } from './onHouseholdChanged.js';
import type { OnHouseholdChangedResolverDeps } from './onHouseholdChanged.js';
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
    parentTypeName: 'Subscription',
    fieldName: 'onHouseholdChanged',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('onHouseholdChanged resolver (Subscription.onHouseholdChanged)', () => {
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

  const baseDeps: OnHouseholdChangedResolverDeps = { getPool: async () => pool };

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

  const createHouseholdWithOwner = async (owner: UserRow, inviteCode: string): Promise<string> =>
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
        return household.id;
      },
      pool,
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-owner-noidentity-ohc');
    const householdId = await createHouseholdWithOwner(owner, 'OHC001');

    const handler = createOnHouseholdChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createOnHouseholdChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-validation-ohc'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-denial-ohc');
    const householdId = await createHouseholdWithOwner(owner, 'OHC002');
    await createUser('sub-stranger-denial-ohc');

    const handler = createOnHouseholdChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-ohc'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-ohc'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe-ohc');
    const handler = createOnHouseholdChangedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-ohc'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-ohc'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('resolves to null (the connection is authorized) for a member caller', async () => {
    const owner = await createUser('sub-owner-success-ohc');
    const householdId = await createHouseholdWithOwner(owner, 'OHC003');

    const handler = createOnHouseholdChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-owner-success-ohc'))).resolves.toBeNull();
  });
});
