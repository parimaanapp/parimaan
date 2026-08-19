import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createUserHouseholdsHandler } from './userHouseholds.js';
import { UnauthorizedError } from '../errors.js';
import type { GraphQLUser } from '../mappers/user.js';

type Source = GraphQLUser;

const buildEvent = (
  source: Source | null,
  cognitoSub: string | null,
): AppSyncResolverEvent<Record<string, never>, Source | null> => ({
  arguments: {},
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
        } as unknown as AppSyncResolverEvent<Record<string, never>>['identity']),
  source,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'User',
    fieldName: 'households',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('User.households field resolver', () => {
  let db: TestDatabase;
  let pool: Pool;
  let handler: ReturnType<typeof createUserHouseholdsHandler>;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
    handler = createUserHouseholdsHandler({ getPool: async () => pool });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const createUserWithHousehold = async (
    cognitoSub: string,
  ): Promise<{ id: string; email: string }> => {
    const client = await pool.connect();
    let user;
    try {
      user = await upsertUserByCognitoSub(client, {
        cognitoSub,
        email: `${cognitoSub}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }

    await withUserTransaction(
      user.id,
      async (txClient: PoolClient) => {
        const household = await insertHousehold(txClient, {
          name: `House of ${cognitoSub}`,
          inviteCode: `INV${cognitoSub.slice(0, 3).toUpperCase()}`,
          primaryUserId: user.id,
        });
        await insertMembership(txClient, {
          householdId: household.id,
          userId: user.id,
          role: 'primary',
        });
        await insertDefaultSettings(txClient, household.id);
      },
      pool,
    );

    return { id: user.id, email: user.email };
  };

  it('returns the memberships when the parent User matches the caller', async () => {
    const user = await createUserWithHousehold('sub-self');
    const source: Source = { id: user.id, email: user.email, displayName: null, avatarUrl: null };

    const result = await handler(buildEvent(source, 'sub-self'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: 'primary' });
  });

  it('returns [] when the parent User does not match the caller', async () => {
    const owner = await createUserWithHousehold('sub-owner');
    const outsiderSource: Source = {
      id: owner.id,
      email: owner.email,
      displayName: null,
      avatarUrl: null,
    };

    const result = await handler(buildEvent(outsiderSource, 'sub-outsider'));
    expect(result).toEqual([]);
  });

  it('throws UnauthorizedError for a null identity', async () => {
    const source: Source = { id: 'anything', email: 'x@example.test', displayName: null, avatarUrl: null };
    await expect(handler(buildEvent(source, null))).rejects.toThrow(UnauthorizedError);
  });
});
