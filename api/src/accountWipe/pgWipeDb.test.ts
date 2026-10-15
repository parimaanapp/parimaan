import { describe, expect, it } from 'vitest';
import { createPgWipeDb } from './pgWipeDb.js';

const recordingClient = () => {
  const statements: string[] = [];
  const fullStatements: string[] = [];
  return {
    statements,
    fullStatements,
    client: {
      query: async (text: string) => {
        fullStatements.push(text);
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

describe('schema qualification (L6/L7)', () => {
  it('every table reference is public.-qualified, so search_path cannot redirect it', async () => {
    const { client, fullStatements } = recordingClient();
    const db = createPgWipeDb(client);
    const snapshot = await db.snapshot(['a@x.test'], []);
    const withPromotion = {
      ...snapshot,
      promotions: [
        {
          householdId: '22222222-2222-4222-8222-222222222222',
          membershipId: '33333333-3333-4333-8333-333333333333',
          newPrimaryUserId: '44444444-4444-4444-8444-444444444444',
        },
      ],
    };
    await db.execute(['a@x.test'], [], withPromotion).catch(() => undefined);
    const reference = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][\w.]*)/gi;
    const found = fullStatements.flatMap((sql) => [...sql.matchAll(reference)].map((m) => m[1] as string));
    expect(found.length).toBeGreaterThan(20);
    const unqualified = found.filter((t) => !t.startsWith('public.') && t !== 'pg_roles');
    expect(unqualified).toEqual([]);
  });
});
