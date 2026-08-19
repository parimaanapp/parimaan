import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { TestDatabase } from './postgres.js';
import { startTestDatabase, truncateAll } from './postgres.js';

describe('startTestDatabase', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await db.stop();
  });

  it('migrates the database so the baseline tables exist', async () => {
    const result = await db.adminClient.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users'
       ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it('returns an appUri that connects successfully as parimaan_app', async () => {
    const appClient = new Client({ connectionString: db.appUri });
    await appClient.connect();
    try {
      const result = await appClient.query('SELECT current_user');
      expect(result.rows[0]).toMatchObject({ current_user: 'parimaan_app' });
    } finally {
      await appClient.end();
    }
  });

  it('truncateAll clears previously inserted rows', async () => {
    await db.adminClient.query(`INSERT INTO users (cognito_sub, email) VALUES ($1, $2)`, [
      `sub-${randomUUID()}`,
      `${randomUUID()}@example.test`,
    ]);
    await truncateAll(db.adminClient);

    const result = await db.adminClient.query('SELECT 1 FROM users');
    expect(result.rows).toHaveLength(0);
  });
});
