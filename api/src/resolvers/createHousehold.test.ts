import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { findMembershipsForUser, insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { createCreateHouseholdHandler } from './createHousehold.js';
import { UnauthorizedError, ValidationError } from '../errors.js';
import type { RandomIntFn } from '../domain/inviteCode.js';

const buildEvent = (
  name: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ name: unknown }> => ({
  arguments: { name },
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
        } as unknown as AppSyncResolverEvent<{ name: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id'],
    selectionSetGraphQL: '{ id }',
    parentTypeName: 'Mutation',
    fieldName: 'createHousehold',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('createHousehold resolver', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const countRows = async (table: string): Promise<number> => {
    const result = await db.adminClient.query(`SELECT 1 FROM ${table}`);
    return result.rows.length;
  };

  it('rejects a null identity with UnauthorizedError, writing zero rows', async () => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    await expect(handler(buildEvent('Test House', null))).rejects.toThrow(UnauthorizedError);
    expect(await countRows('households')).toBe(0);
  });

  it.each([
    ['empty string', ''],
    ['whitespace-only', '   '],
    ['over 60 chars', 'a'.repeat(61)],
    ['absent', undefined],
    ['numeric', 12345],
    ['control character', 'Bad\tName'],
  ])('rejects a %s name with ValidationError, writing zero rows', async (_label, name) => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    await expect(handler(buildEvent(name, 'sub-validation'))).rejects.toThrow(ValidationError);
    expect(await countRows('households')).toBe(0);
  });

  it('happy path: creates a household, primary membership, and default settings matching the domain defaults', async () => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    const result = await handler(buildEvent('The Sharma House', 'sub-happy'));

    expect(result.name).toBe('The Sharma House');
    expect(result.inviteCode).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(result.subscriptionStatus).toBe('free');
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({ role: 'primary' });
    expect(result.settings.mealsEnabled).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(JSON.parse(result.settings.mealStructure)).toEqual({
      lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
      dinner: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
    });

    expect(await countRows('households')).toBe(1);
    expect(await countRows('household_memberships')).toBe(1);
    expect(await countRows('household_settings')).toBe(1);

    const client = await pool.connect();
    try {
      const householdRow = await client.query('SELECT primary_user_id FROM households WHERE id = $1', [
        result.id,
      ]);
      const userRow = await client.query('SELECT id FROM users WHERE cognito_sub = $1', ['sub-happy']);
      expect(householdRow.rows[0].primary_user_id).toBe(userRow.rows[0].id);
    } finally {
      client.release();
    }
  });

  it("derives primaryUserId from identity.sub, never influenceable via arguments", async () => {
    const handler = createCreateHouseholdHandler({ getPool: async () => pool });
    const event = buildEvent('No Injection House', 'sub-noinject');
    // There is no primaryUserId/userId argument on this mutation at all —
    // assert the arguments object truly has no such field, and that the
    // resulting household's primary_user_id matches the caller derived from
    // identity, not anything in `arguments`.
    expect(Object.keys(event.arguments)).toEqual(['name']);

    const result = await handler(event);
    const client = await pool.connect();
    try {
      const userRow = await client.query('SELECT id FROM users WHERE cognito_sub = $1', [
        'sub-noinject',
      ]);
      expect(result.primaryUserId).toBe(userRow.rows[0].id);
    } finally {
      client.release();
    }
  });

  it('retries invite code generation on a collision, succeeding on the second attempt', async () => {
    // Pre-seed a household with a known invite code.
    const client = await pool.connect();
    let seededOwnerId: string;
    try {
      const owner = await upsertUserByCognitoSub(client, {
        cognitoSub: 'sub-seed',
        email: 'seed@example.test',
        displayName: null,
        avatarUrl: null,
      });
      seededOwnerId = owner.id;
    } finally {
      client.release();
    }
    await withUserTransaction(
      seededOwnerId,
      async (txClient) => {
        const seeded = await insertHousehold(txClient, {
          name: 'Seed House',
          inviteCode: 'AAA234',
          primaryUserId: seededOwnerId,
        });
        await insertMembership(txClient, {
          householdId: seeded.id,
          userId: seededOwnerId,
          role: 'primary',
        });
        await insertDefaultSettings(txClient, seeded.id);
      },
      pool,
    );

    const collidingThenFresh: RandomIntFn = (() => {
      let call = 0;
      // First 6 randomInt calls spell out 'AAA234' (the seeded code);
      // the next 6 spell out 'BBB234' (a fresh code).
      const codes = ['AAA234', 'BBB234'];
      const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
      return (_min: number, _max: number): number => {
        const codeIndex = Math.floor(call / 6);
        const charIndex = call % 6;
        call += 1;
        const code = codes[codeIndex];
        if (code === undefined) {
          throw new Error('ran out of stubbed invite codes');
        }
        const char = code[charIndex];
        if (char === undefined) {
          throw new Error('invite code stub out of range');
        }
        return alphabet.indexOf(char);
      };
    })();

    const handler = createCreateHouseholdHandler({
      getPool: async () => pool,
      randomInt: collidingThenFresh,
    });
    const result = await handler(buildEvent('Retry House', 'sub-retry'));
    expect(result.inviteCode).toBe('BBB234');
    expect(await countRows('households')).toBe(2);
  });

  it('exhausts invite code retries (5 attempts) and throws, writing zero new rows', async () => {
    const alwaysCollide: RandomIntFn = () => 0; // '2' repeated, alphabet[0] === '2'
    const client = await pool.connect();
    let seededOwnerId: string;
    try {
      const owner = await upsertUserByCognitoSub(client, {
        cognitoSub: 'sub-exhaust-seed',
        email: 'exhaust-seed@example.test',
        displayName: null,
        avatarUrl: null,
      });
      seededOwnerId = owner.id;
    } finally {
      client.release();
    }
    await withUserTransaction(
      seededOwnerId,
      async (txClient) => {
        const seeded = await insertHousehold(txClient, {
          name: 'Collision House',
          inviteCode: '222222',
          primaryUserId: seededOwnerId,
        });
        await insertMembership(txClient, {
          householdId: seeded.id,
          userId: seededOwnerId,
          role: 'primary',
        });
        await insertDefaultSettings(txClient, seeded.id);
      },
      pool,
    );

    const handler = createCreateHouseholdHandler({
      getPool: async () => pool,
      randomInt: alwaysCollide,
    });
    await expect(handler(buildEvent('Exhausted House', 'sub-exhaust'))).rejects.toThrow();
    expect(await countRows('households')).toBe(1); // only the pre-seeded one
  });

  it('rolls back the transaction if the settings insert fails, leaving no household or membership rows', async () => {
    const handler = createCreateHouseholdHandler({
      getPool: async () => pool,
      insertDefaultSettings: async () => {
        throw new Error('Forced settings-insert failure for this test.');
      },
    });

    await expect(handler(buildEvent('Rollback House', 'sub-rollback'))).rejects.toThrow();
    expect(await countRows('households')).toBe(0);
    expect(await countRows('household_memberships')).toBe(0);
  });

  it("cross-tenant: user B's memberships never include user A's household", async () => {
    const handlerA = createCreateHouseholdHandler({ getPool: async () => pool });
    await handlerA(buildEvent('House A', 'sub-cross-a'));

    const clientB = await pool.connect();
    let userB;
    try {
      userB = await upsertUserByCognitoSub(clientB, {
        cognitoSub: 'sub-cross-b',
        email: 'sub-cross-b@example.test',
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      clientB.release();
    }

    const membershipsB = await withUserTransaction(
      userB.id,
      (client) => findMembershipsForUser(client, userB.id),
      pool,
    );
    expect(membershipsB).toEqual([]);
  });
});
