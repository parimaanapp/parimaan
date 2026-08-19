import { describe, expect, it } from 'vitest';
import { buildDatabaseUrl } from './buildDatabaseUrl.js';

describe('buildDatabaseUrl', () => {
  it('builds a postgres:// URL from the given parts', () => {
    const url = buildDatabaseUrl({
      username: 'admin',
      password: 'secret',
      host: 'db.example.internal',
      port: 5432,
      dbName: 'parimaan',
    });
    expect(url).toBe('postgres://admin:secret@db.example.internal:5432/parimaan');
  });

  it('URL-encodes special characters in the username and password', () => {
    const url = buildDatabaseUrl({
      username: 'user@name',
      password: 'p:a/s%s#w?ord',
      host: 'db.example.internal',
      port: 5432,
      dbName: 'parimaan',
    });

    // Round-trip through the URL parser rather than asserting on the raw
    // encoded string, so this test doesn't depend on encodeURIComponent's
    // exact escaping choices — only on the URL actually parsing back to the
    // original credentials.
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe('user@name');
    expect(decodeURIComponent(parsed.password)).toBe('p:a/s%s#w?ord');
    expect(parsed.hostname).toBe('db.example.internal');
    expect(parsed.port).toBe('5432');
    expect(parsed.pathname).toBe('/parimaan');
  });
});
