import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { createMeHandler } from './me.js';
import { UnauthorizedError } from '../errors.js';
import { resetCallerUserCacheForTesting } from '../repositories/callerUser.js';

const buildEvent = (
  identityOverrides: Record<string, unknown> | null,
): AppSyncResolverEvent<Record<string, never>> => ({
  arguments: {},
  identity:
    identityOverrides === null
      ? null
      : ({
          sub: 'fake-user-sub',
          issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
          username: 'fake-user',
          claims: {
            email: 'fake@example.test',
            ...identityOverrides,
          },
          sourceIp: ['127.0.0.1'],
          defaultAuthStrategy: 'ALLOW',
          groups: null,
        } as unknown as AppSyncResolverEvent<Record<string, never>>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'email'],
    selectionSetGraphQL: '{ id email }',
    parentTypeName: 'Query',
    fieldName: 'me',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('me resolver', () => {
  let db: TestDatabase;
  let pool: Pool;
  let handler: ReturnType<typeof createMeHandler>;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
    handler = createMeHandler({ getPool: async () => pool });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  beforeEach(() => {
    // Every test in this file authenticates as the same 'fake-user-sub' —
    // without this, W8 S6's caller-identity cache would serve a later
    // test's `resolveCallerUser` call from an earlier test's cached row,
    // even though `truncateAll` just wiped the underlying table.
    resetCallerUserCacheForTesting();
  });

  const countUsers = async (): Promise<number> => {
    const result = await db.adminClient.query('SELECT 1 FROM users');
    return result.rows.length;
  };

  it('rejects a null identity with UnauthorizedError and writes zero rows', async () => {
    await expect(handler(buildEvent(null))).rejects.toThrow(UnauthorizedError);
    expect(await countUsers()).toBe(0);
  });

  it('rejects a non-Cognito identity shape with UnauthorizedError', async () => {
    const event = buildEvent(null);
    const nonCognitoEvent = {
      ...event,
      identity: {
        accountId: '123456789012',
        userArn: 'arn:aws:iam::123456789012:role/some-role',
      } as unknown as AppSyncResolverEvent<Record<string, never>>['identity'],
    };
    await expect(handler(nonCognitoEvent)).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a missing email claim, writing zero rows', async () => {
    await expect(handler(buildEvent({ email: undefined }))).rejects.toThrow();
    expect(await countUsers()).toBe(0);
  });

  it('creates exactly one users row on first login', async () => {
    await handler(buildEvent({}));
    expect(await countUsers()).toBe(1);
  });

  it('second login with the same sub still yields one row; a changed name is served stale until the caller-identity cache clears (W8 S6)', async () => {
    await handler(buildEvent({ name: 'First Name' }));
    const result = await handler(buildEvent({ name: 'Second Name' }));
    expect(await countUsers()).toBe(1);
    expect(result.displayName).toBe('First Name');

    resetCallerUserCacheForTesting();
    const afterCacheClears = await handler(buildEvent({ name: 'Second Name' }));
    expect(await countUsers()).toBe(1);
    expect(afterCacheClears.displayName).toBe('Second Name');
  });

  it('two concurrent invocations with the same sub still yield one row (ON CONFLICT race)', async () => {
    await Promise.all([handler(buildEvent({})), handler(buildEvent({}))]);
    expect(await countUsers()).toBe(1);
  });

  it('returns the raw mapped object, not an API-Gateway { statusCode, body } wrapper', async () => {
    const result = await handler(buildEvent({}));
    expect(result).not.toHaveProperty('statusCode');
    expect(result).not.toHaveProperty('body');
    expect(result).toMatchObject({ email: 'fake@example.test' });
  });
});
