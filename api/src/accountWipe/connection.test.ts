import { describe, expect, it } from 'vitest';
import type { WipeConfig } from './cli.js';
import { assertConnectedHost, buildPgConfig, readCurrentDatabase } from './connection.js';

const database: WipeConfig['database'] = {
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'pw',
  name: 'parimaan',
};

describe('buildPgConfig', () => {
  it('uses explicit parts and never a connection string', () => {
    const config = buildPgConfig({ database, dbServername: 'db.dev.rds.test' }, 'CA');
    expect(config).toMatchObject({
      host: 'localhost',
      port: 5432,
      user: 'admin',
      password: 'pw',
      database: 'parimaan',
    });
    expect('connectionString' in config).toBe(false);
  });

  it('always verifies TLS against the supplied CA, with the servername override', () => {
    const config = buildPgConfig({ database, dbServername: 'db.dev.rds.test' }, 'CA');
    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'CA',
      servername: 'db.dev.rds.test',
    });
    expect(buildPgConfig({ database }, 'CA').ssl).toEqual({ rejectUnauthorized: true, ca: 'CA' });
  });
});

describe('assertConnectedHost', () => {
  it('passes when the connected host is the checked host', () => {
    expect(() => assertConnectedHost({ host: 'localhost' }, 'localhost')).not.toThrow();
  });

  it('fails when the connection terminates somewhere else or cannot be determined', () => {
    expect(() => assertConnectedHost({ host: 'other.example' }, 'localhost')).toThrow(/host/);
    expect(() => assertConnectedHost({}, 'localhost')).toThrow(/host/);
  });
});

describe('readCurrentDatabase', () => {
  it('returns current_database()', async () => {
    const client = {
      query: async (text: string) => {
        expect(text).toMatch(/current_database\(\)/);
        return { rows: [{ name: 'parimaan' }], rowCount: 1 };
      },
    };
    await expect(readCurrentDatabase(client)).resolves.toBe('parimaan');
  });
});
