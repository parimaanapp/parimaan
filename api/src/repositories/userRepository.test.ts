import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { findUserByCognitoSub, upsertUserByCognitoSub } from './userRepository.js';
import { ConflictError } from '../errors.js';
import type { CallerIdentity } from '../auth/identity.js';

describe('userRepository', () => {
  let db: TestDatabase;
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    db = await startTestDatabase();
    // Connected as parimaan_app (via appUri), per this repo's convention —
    // proves these functions work under the least-privileged role, not just
    // the Postgres superuser.
    pool = new Pool({ connectionString: db.appUri });
    client = await pool.connect();
  }, 60_000);

  afterAll(async () => {
    client.release();
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const identity = (overrides: Partial<CallerIdentity> = {}): CallerIdentity => ({
    cognitoSub: 'sub-1',
    email: 'user1@example.test',
    displayName: 'User One',
    avatarUrl: 'https://example.test/avatar.png',
    ...overrides,
  });

  it('first call inserts a new user row', async () => {
    const row = await upsertUserByCognitoSub(client, identity());
    expect(row).toMatchObject({
      cognitoSub: 'sub-1',
      email: 'user1@example.test',
      displayName: 'User One',
      avatarUrl: 'https://example.test/avatar.png',
    });
    expect(row.id).toBeTypeOf('string');
  });

  it('second call with the same sub does not duplicate, and updates a changed displayName', async () => {
    const first = await upsertUserByCognitoSub(client, identity());
    const second = await upsertUserByCognitoSub(
      client,
      identity({ displayName: 'User One Renamed' }),
    );

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('User One Renamed');

    const all = await client.query('SELECT id FROM users');
    expect(all.rows).toHaveLength(1);
  });

  it('second call with now-absent name claim preserves the previously stored displayName', async () => {
    await upsertUserByCognitoSub(client, identity({ displayName: 'User One' }));
    const second = await upsertUserByCognitoSub(client, identity({ displayName: null }));

    expect(second.displayName).toBe('User One');
  });

  it('second call with now-absent picture claim preserves the previously stored avatarUrl', async () => {
    await upsertUserByCognitoSub(
      client,
      identity({ avatarUrl: 'https://example.test/avatar.png' }),
    );
    const second = await upsertUserByCognitoSub(client, identity({ avatarUrl: null }));

    expect(second.avatarUrl).toBe('https://example.test/avatar.png');
  });

  it('same email with a different cognito_sub raises ConflictError, not a raw pg error', async () => {
    await upsertUserByCognitoSub(client, identity({ cognitoSub: 'sub-1', email: 'shared@example.test' }));

    await expect(
      upsertUserByCognitoSub(client, identity({ cognitoSub: 'sub-2', email: 'shared@example.test' })),
    ).rejects.toThrow(ConflictError);
  });

  it('findUserByCognitoSub returns null for an unknown sub', async () => {
    const result = await findUserByCognitoSub(client, 'nonexistent-sub');
    expect(result).toBeNull();
  });

  it('findUserByCognitoSub returns the matching row', async () => {
    const inserted = await upsertUserByCognitoSub(client, identity());
    const found = await findUserByCognitoSub(client, 'sub-1');
    expect(found).toMatchObject({ id: inserted.id, cognitoSub: 'sub-1' });
  });
});
