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
import { createOnRecipeChangedHandler } from './onRecipeChanged.js';
import type { OnRecipeChangedResolverDeps } from './onRecipeChanged.js';
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
    fieldName: 'onRecipeChanged',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('onRecipeChanged resolver (Subscription.onRecipeChanged)', () => {
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

  const baseDeps: OnRecipeChangedResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-owner-noidentity-orc');
    const householdId = await createHouseholdWithOwner(owner, 'ORC001');

    const handler = createOnRecipeChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createOnRecipeChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-validation-orc'))).rejects.toThrow(
      ValidationError,
    );
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-denial-orc');
    const householdId = await createHouseholdWithOwner(owner, 'ORC002');
    await createUser('sub-stranger-denial-orc');

    const handler = createOnRecipeChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-orc'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-orc'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe-orc');
    const handler = createOnRecipeChangedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-orc'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-orc'))).rejects.toThrow(
      DENIAL_MESSAGE,
    );
  });

  it('resolves to null (the connection is authorized) for a member caller', async () => {
    const owner = await createUser('sub-owner-success-orc');
    const householdId = await createHouseholdWithOwner(owner, 'ORC003');

    const handler = createOnRecipeChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-owner-success-orc'))).resolves.toBeNull();
  });
});
