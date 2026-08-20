import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
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
import { requireHouseholdMember } from './requireHouseholdMember.js';
import { ForbiddenError } from '../errors.js';

describe('requireHouseholdMember', () => {
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
      return await upsertUserByCognitoSub(client, {
        cognitoSub: `sub-${randomUUID()}`,
        email: `${randomUUID()}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const createHousehold = async (owner: UserRow): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, {
          name: `House of ${owner.id}`,
          inviteCode: `H${randomUUID().slice(0, 5).toUpperCase()}`,
          primaryUserId: owner.id,
        });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        return household.id;
      },
      pool,
    );

  it("returns the caller's role when they are a member", async () => {
    const owner = await createUser();
    const householdId = await createHousehold(owner);

    const role = await withUserTransaction(
      owner.id,
      (client) => requireHouseholdMember(client, owner.id, householdId),
      pool,
    );
    expect(role).toBe('primary');
  });

  it('throws ForbiddenError when the caller is not a member of a real household', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const householdId = await createHousehold(owner);

    await expect(
      withUserTransaction(
        stranger.id,
        (client) => requireHouseholdMember(client, stranger.id, householdId),
        pool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws the identical ForbiddenError for a syntactically-valid but nonexistent household UUID', async () => {
    const stranger = await createUser();
    const owner = await createUser();
    const householdId = await createHousehold(owner);

    let nonMemberError: Error | undefined;
    try {
      await withUserTransaction(
        stranger.id,
        (client) => requireHouseholdMember(client, stranger.id, householdId),
        pool,
      );
    } catch (error) {
      nonMemberError = error as Error;
    }

    let nonexistentError: Error | undefined;
    try {
      await withUserTransaction(
        stranger.id,
        (client) => requireHouseholdMember(client, stranger.id, randomUUID()),
        pool,
      );
    } catch (error) {
      nonexistentError = error as Error;
    }

    expect(nonMemberError).toBeInstanceOf(ForbiddenError);
    expect(nonexistentError).toBeInstanceOf(ForbiddenError);
    // The whole point: identical message, so this can never be used as a
    // household-existence oracle by comparing error text between the two cases.
    expect(nonMemberError?.message).toBe(nonexistentError?.message);
  });
});
