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
import { createOnMembershipRevokedHandler } from './onMembershipRevoked.js';
import type { OnMembershipRevokedResolverDeps } from './onMembershipRevoked.js';
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
    selectionSetList: [],
    selectionSetGraphQL: '',
    parentTypeName: 'Subscription',
    fieldName: 'onMembershipRevoked',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('onMembershipRevoked resolver (Subscription.onMembershipRevoked, D7)', () => {
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

  const baseDeps: OnMembershipRevokedResolverDeps = { getPool: async () => pool };

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
    const owner = await createUser('sub-omr-noidentity');
    const householdId = await createHouseholdWithOwner(owner, 'OMR001');

    const handler = createOnMembershipRevokedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['explicit null', null],
    ['numeric', 12345],
  ])('rejects a %s householdId with ValidationError', async (_label, householdId) => {
    const handler = createOnMembershipRevokedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-validation-omr'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-owner-denial-omr');
    const householdId = await createHouseholdWithOwner(owner, 'OMR002');
    await createUser('sub-stranger-denial-omr');

    const handler = createOnMembershipRevokedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-omr'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(householdId, 'sub-stranger-denial-omr'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-oracle-probe-omr');
    const handler = createOnMembershipRevokedHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-omr'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-oracle-probe-omr'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('resolves to null (the connection is authorized) for a member caller', async () => {
    const owner = await createUser('sub-owner-success-omr');
    const householdId = await createHouseholdWithOwner(owner, 'OMR003');

    const handler = createOnMembershipRevokedHandler(baseDeps);
    await expect(handler(buildEvent(householdId, 'sub-owner-success-omr'))).resolves.toBeNull();
  });

  it('denies a caller identically for two different households — cross-household isolation, not shared state leaking through the authorizer', async () => {
    const ownerA = await createUser('sub-owner-a-omr');
    const ownerB = await createUser('sub-owner-b-omr');
    const householdA = await createHouseholdWithOwner(ownerA, 'OMR004');
    const householdB = await createHouseholdWithOwner(ownerB, 'OMR005');

    const handler = createOnMembershipRevokedHandler(baseDeps);
    // ownerA is a member of A but not B — denied for B, authorized for A.
    await expect(handler(buildEvent(householdB, 'sub-owner-a-omr'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(householdA, 'sub-owner-a-omr'))).resolves.toBeNull();
  });
});

describe('onMembershipRevoked SDL wiring (D7, E2E_MVP_PLAN.md §17.2.7)', () => {
  it('is @aws_subscribe-d to deleteHousehold ONLY, typed Boolean — zero return-type widening', () => {
    const schemaPath = fileURLToPath(new URL('../../../shared/schema.graphql', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf-8');

    const match = schema.match(
      /onMembershipRevoked\(householdId: ID!\): Boolean\s*\n\s*@aws_subscribe\(mutations: (\[[^\]]*\])\)/,
    );
    expect(
      match,
      'onMembershipRevoked field with an @aws_subscribe directive, typed Boolean, must exist in schema.graphql',
    ).not.toBeNull();

    const mutationsList = match![1]!;
    // Parses to exactly one mutation name — a regression test for D7's own
    // scope boundary (only the one real member-removal event this codebase
    // has today), not left implicit.
    const parsed = JSON.parse(mutationsList) as string[];
    expect(parsed).toEqual(['deleteHousehold']);
  });

  it('deleteHousehold itself still returns Boolean! — the field this subscription attaches to without any widening', () => {
    const schemaPath = fileURLToPath(new URL('../../../shared/schema.graphql', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf-8');
    expect(schema).toMatch(/deleteHousehold\([^)]*\): Boolean!/);
  });
});
