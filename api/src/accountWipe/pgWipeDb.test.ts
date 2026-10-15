import { describe, expect, it } from 'vitest';
import { createPgWipeDb } from './pgWipeDb.js';

const recordingClient = () => {
  const statements: string[] = [];
  return {
    statements,
    client: {
      query: async (text: string) => {
        statements.push(text.trim().split('\n')[0] as string);
        if (text.includes('rolbypassrls')) return { rows: [{ ok: true }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    },
  };
};

describe('createPgWipeDb transactions', () => {
  it('snapshot runs in a REPEATABLE READ, READ ONLY transaction and always rolls back', async () => {
    const { client, statements } = recordingClient();
    await createPgWipeDb(client).snapshot(['a@x.test'], []);
    expect(statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('execute runs in a REPEATABLE READ transaction', async () => {
    const { client, statements } = recordingClient();
    const db = createPgWipeDb(client);
    const snapshot = await db.snapshot(['a@x.test'], []);
    statements.length = 0;
    await db.execute(['a@x.test'], [], snapshot);
    expect(statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ');
    expect(statements.at(-1)).toBe('COMMIT');
  });
});
