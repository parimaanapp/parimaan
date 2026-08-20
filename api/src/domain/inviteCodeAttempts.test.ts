import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertHousehold } from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { INVITE_CODE_ALPHABET } from './inviteCode.js';
import type { RandomIntFn } from './inviteCode.js';
import { MAX_INVITE_CODE_ATTEMPTS, attemptWithFreshInviteCode } from './inviteCodeAttempts.js';

/**
 * A deterministic `RandomIntFn` that makes `generateInviteCode` emit exactly
 * `codes`, in order — the same stubbing technique `createHousehold.test.ts`
 * already uses for its own collision test, extracted here as a local helper
 * because these tests need several different code sequences.
 */
const stubRandomInt = (codes: readonly string[]): RandomIntFn => {
  let call = 0;
  return (): number => {
    const code = codes[Math.floor(call / 6)];
    const char = code?.[call % 6];
    call += 1;
    if (char === undefined) {
      throw new Error('ran out of stubbed invite codes');
    }
    return INVITE_CODE_ALPHABET.indexOf(char);
  };
};

describe('attemptWithFreshInviteCode', () => {
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

  const createUser = async (): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      const sub = `sub-${randomUUID()}`;
      return await upsertUserByCognitoSub(client, {
        cognitoSub: sub,
        email: `${sub}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const seedHousehold = async (owner: UserRow, inviteCode: string): Promise<void> => {
    await withUserTransaction(
      owner.id,
      async (client) => {
        await insertHousehold(client, { name: `Seed ${inviteCode}`, inviteCode, primaryUserId: owner.id });
      },
      pool,
    );
  };

  it('calls write once with a generated code and returns its result when there is no collision', async () => {
    const owner = await createUser();
    const seen: string[] = [];

    const result = await withUserTransaction(
      owner.id,
      (client) =>
        attemptWithFreshInviteCode(
          client,
          async (inviteCode) => {
            seen.push(inviteCode);
            return inviteCode.toLowerCase();
          },
          stubRandomInt(['AAA234']),
        ),
      pool,
    );

    expect(seen).toEqual(['AAA234']);
    expect(result).toBe('aaa234');
  });

  it('retries with a fresh code on a households_invite_code_key collision and succeeds on the second attempt', async () => {
    const owner = await createUser();
    await seedHousehold(owner, 'AAA234');
    const seen: string[] = [];

    const household = await withUserTransaction(
      owner.id,
      (client) =>
        attemptWithFreshInviteCode(
          client,
          (inviteCode) => {
            seen.push(inviteCode);
            return insertHousehold(client, { name: 'Retry House', inviteCode, primaryUserId: owner.id });
          },
          stubRandomInt(['AAA234', 'BBB234']),
        ),
      pool,
    );

    expect(seen).toEqual(['AAA234', 'BBB234']);
    expect(household.inviteCode).toBe('BBB234');
  });

  it('propagates a non-collision error immediately, without a second attempt', async () => {
    const owner = await createUser();
    const seen: string[] = [];
    const sentinel = new Error('not a collision');

    await expect(
      withUserTransaction(
        owner.id,
        (client) =>
          attemptWithFreshInviteCode(
            client,
            (inviteCode) => {
              seen.push(inviteCode);
              return Promise.reject(sentinel);
            },
            stubRandomInt(['AAA234', 'BBB234']),
          ),
        pool,
      ),
    ).rejects.toBe(sentinel);

    expect(seen).toHaveLength(1);
  });

  it(`throws after ${MAX_INVITE_CODE_ATTEMPTS} colliding attempts, carrying the last pg error as its cause`, async () => {
    const owner = await createUser();
    await seedHousehold(owner, '222222');
    const seen: string[] = [];

    const thrown = await withUserTransaction(
      owner.id,
      async (client) => {
        try {
          await attemptWithFreshInviteCode(
            client,
            (inviteCode) => {
              seen.push(inviteCode);
              return insertHousehold(client, {
                name: 'Exhausted House',
                inviteCode,
                primaryUserId: owner.id,
              });
            },
            () => 0, // alphabet[0] === '2', so every attempt mints '222222'
          );
          return null;
        } catch (error) {
          return error;
        }
      },
      pool,
    );

    expect(seen).toHaveLength(MAX_INVITE_CODE_ATTEMPTS);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      new RegExp(`unique household invite code after ${MAX_INVITE_CODE_ATTEMPTS} attempts`),
    );
    expect((thrown as Error).cause).toMatchObject({ code: '23505' });

    // The outer transaction is still usable after five rolled-back attempts —
    // proof the per-attempt savepoints scoped each abort correctly.
    const count = await pool.query('SELECT count(*)::int AS n FROM households');
    expect(count.rows[0].n).toBe(1);
  });
});
