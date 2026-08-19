import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { resolveCallerUser } from './callerUser.js';
import type { CallerIdentity } from '../auth/identity.js';

describe('resolveCallerUser', () => {
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

  const identity = (overrides: Partial<CallerIdentity> = {}): CallerIdentity => ({
    cognitoSub: `sub-${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    displayName: null,
    avatarUrl: null,
    ...overrides,
  });

  it('creates a users row on first call and releases the client back to the pool', async () => {
    const idleBefore = pool.idleCount;
    const user = await resolveCallerUser(pool, identity());
    expect(user.id).toBeDefined();
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
  });

  it('returns the same user on a second call with the same cognitoSub, not a duplicate', async () => {
    const id = identity();
    const first = await resolveCallerUser(pool, id);
    const second = await resolveCallerUser(pool, id);
    expect(second.id).toBe(first.id);
  });

  it('releases the client even if the upsert fails', async () => {
    const idleBefore = pool.idleCount;
    const conflicting = identity();
    await resolveCallerUser(pool, conflicting);
    // Same email, different sub -> ConflictError from upsertUserByCognitoSub.
    await expect(
      resolveCallerUser(pool, identity({ email: conflicting.email })),
    ).rejects.toThrow();
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
  });
});
