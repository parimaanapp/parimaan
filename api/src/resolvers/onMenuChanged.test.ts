import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { createOnMenuChangedHandler } from './onMenuChanged.js';
import type { OnMenuChangedResolverDeps } from './onMenuChanged.js';
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
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Subscription',
    fieldName: 'onMenuChanged',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('onMenuChanged resolver (Subscription.onMenuChanged)', () => {
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

  const baseDeps: OnMenuChangedResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-omc-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'OMC001');

    const handler = createOnMenuChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createOnMenuChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-validation-omc'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-denial-omc');
    const householdId = await createHouseholdWithOwner(owner, 'OMC002');
    await createUser('sub-stranger-denial-omc');

    const handler = createOnMenuChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-omc'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-omc'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe-omc');
    const handler = createOnMenuChangedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-omc'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-omc'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('resolves to null (the connection is authorized) for a member caller', async () => {
    const owner = await createUser('sub-owner-success-omc');
    const householdId = await createHouseholdWithOwner(owner, 'OMC003');

    const handler = createOnMenuChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-owner-success-omc'))).resolves.toBeNull();
  });
});

describe('onMenuChanged SDL wiring (D9-carryover, E2E_MVP_PLAN.md §17.2.9)', () => {
  it('is @aws_subscribe-d to createMenu ONLY — never addMenuItem/removeMenuItem/autoFillWeek', () => {
    const schemaPath = fileURLToPath(new URL('../../../shared/schema.graphql', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf-8');

    const match = schema.match(/onMenuChanged\(householdId: ID!\): Menu\s*\n\s*@aws_subscribe\(mutations: (\[[^\]]*\])\)/);
    expect(match, 'onMenuChanged field with an @aws_subscribe directive must exist in schema.graphql').not.toBeNull();

    const mutationsList = match![1]!;
    expect(mutationsList).toContain('"createMenu"');
    expect(mutationsList).not.toContain('addMenuItem');
    expect(mutationsList).not.toContain('removeMenuItem');
    expect(mutationsList).not.toContain('autoFillWeek');

    // Parses to exactly one mutation name, not merely "doesn't contain the
    // others" — a regression test for D9-carryover's own scope boundary,
    // not left implicit.
    const parsed = JSON.parse(mutationsList) as string[];
    expect(parsed).toEqual(['createMenu']);
  });
});
