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
import { createOnShoppingListChangedHandler } from './onShoppingListChanged.js';
import type { OnShoppingListChangedResolverDeps } from './onShoppingListChanged.js';
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
    fieldName: 'onShoppingListChanged',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('onShoppingListChanged resolver (Subscription.onShoppingListChanged)', () => {
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

  const baseDeps: OnShoppingListChangedResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-oslc-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'OSL001');

    const handler = createOnShoppingListChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
    ['explicit null', null],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createOnShoppingListChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-validation-oslc'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-denial-oslc');
    const householdId = await createHouseholdWithOwner(owner, 'OSL002');
    await createUser('sub-stranger-denial-oslc');

    const handler = createOnShoppingListChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-oslc'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-oslc'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe-oslc');
    const handler = createOnShoppingListChangedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-oslc'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-oslc'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('resolves to null (the connection is authorized) for a member caller', async () => {
    const owner = await createUser('sub-owner-success-oslc');
    const householdId = await createHouseholdWithOwner(owner, 'OSL003');

    const handler = createOnShoppingListChangedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-owner-success-oslc'))).resolves.toBeNull();
  });
});

describe('onShoppingListChanged SDL wiring (D1, E2E_MVP_PLAN.md §18.2.1)', () => {
  it('is @aws_subscribe-d to exactly generateShoppingList/regenerateShoppingList/haveIt/markPurchased', () => {
    const schemaPath = fileURLToPath(new URL('../../../shared/schema.graphql', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf-8');

    const match = schema.match(
      /onShoppingListChanged\(householdId: ID!\): ShoppingList\s*\n\s*@aws_subscribe\(\s*\n?\s*mutations: (\[[^\]]*\])/,
    );
    expect(
      match,
      'onShoppingListChanged field with an @aws_subscribe directive must exist in schema.graphql',
    ).not.toBeNull();

    const mutationsList = match![1]!;
    const parsed = JSON.parse(mutationsList) as string[];
    expect(parsed).toEqual(['generateShoppingList', 'regenerateShoppingList', 'haveIt', 'markPurchased']);
  });
});
