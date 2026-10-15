import { describe, expect, it } from 'vitest';
import { loadWipeConfig, parseCliArgs } from './cli.js';

const readFile = (path: string): string =>
  path === 'emails.txt' ? '# founders\nA@x.test\n\nb@x.test\n' : '';

describe('parseCliArgs', () => {
  it('defaults to dry-run', () => {
    expect(parseCliArgs(['--emails', 'a@x.test,b@x.test'], readFile)).toEqual({
      mode: 'dry-run',
      emails: ['a@x.test', 'b@x.test'],
    });
  });

  it('reads emails from a file, skipping comments and blanks', () => {
    const parsed = parseCliArgs(['--emails-file', 'emails.txt'], readFile);
    expect(parsed.emails).toEqual(['A@x.test', 'b@x.test']);
  });

  it('accepts --execute with --confirm', () => {
    const parsed = parseCliArgs(['--emails', 'a@x.test', '--execute', '--confirm', 'abc'], readFile);
    expect(parsed).toEqual({ mode: 'execute', emails: ['a@x.test'], confirm: 'abc' });
  });

  it('accepts --full-listing <file> in both modes', () => {
    expect(
      parseCliArgs(['--emails', 'a@x.test', '--full-listing', 'out.json'], readFile),
    ).toEqual({ mode: 'dry-run', emails: ['a@x.test'], fullListingPath: 'out.json' });
    const executed = parseCliArgs(
      ['--emails', 'a@x.test', '--execute', '--confirm', 'abc', '--full-listing', 'out.json'],
      readFile,
    );
    expect(executed).toMatchObject({ mode: 'execute', fullListingPath: 'out.json' });
  });

  it('requires a value for --full-listing', () => {
    expect(() => parseCliArgs(['--emails', 'a@x.test', '--full-listing'], readFile)).toThrow(
      /requires a value/,
    );
  });

  it('rejects --execute without --confirm', () => {
    expect(() => parseCliArgs(['--emails', 'a@x.test', '--execute'], readFile)).toThrow(/--confirm/);
  });

  it('rejects --dry-run together with --execute', () => {
    expect(() =>
      parseCliArgs(['--emails', 'a@x.test', '--dry-run', '--execute', '--confirm', 'x'], readFile),
    ).toThrow(/either/);
  });

  it('rejects --confirm without --execute', () => {
    expect(() => parseCliArgs(['--emails', 'a@x.test', '--confirm', 'x'], readFile)).toThrow(
      /only valid with --execute/,
    );
  });

  it('rejects missing emails and unknown flags', () => {
    expect(() => parseCliArgs([], readFile)).toThrow(/--emails/);
    expect(() => parseCliArgs(['--emails', 'a@x.test', '--nuke'], readFile)).toThrow(/Unknown/);
  });
});

describe('loadWipeConfig', () => {
  const base = {
    WIPE_ENV: 'dev',
    AWS_REGION: 'ap-south-1',
    WIPE_USER_POOL_ID: 'ap-south-1_abc',
    WIPE_UPLOADS_BUCKET: 'parimaan-uploads-dev',
    WIPE_EXPORTS_BUCKET: 'parimaan-exports-dev',
    WIPE_CACHE_TABLE: 'parimaan-cache-dev',
    WIPE_DATABASE_URL: 'postgres://u:p@localhost:5432/parimaan',
    WIPE_EXPECTED_ACCOUNT_ID: '123456789012',
    WIPE_EXPECTED_POOL_NAME: 'parimaan-dev',
    WIPE_EXPECTED_DB_HOST: 'db.dev.rds.test',
    WIPE_EXPECTED_DB_NAME: 'parimaan',
    WIPE_DATABASE_SERVERNAME: 'db.dev.rds.test',
  };

  it('loads a complete dev config', () => {
    expect(loadWipeConfig(base).uploadsBucket).toBe('parimaan-uploads-dev');
  });

  it('is dev-only: refuses any other WIPE_ENV', () => {
    expect(() => loadWipeConfig({ ...base, WIPE_ENV: 'prod' })).toThrow(/dev/);
    expect(() => loadWipeConfig({ ...base, WIPE_ENV: undefined })).toThrow(/WIPE_ENV/);
  });

  it('refuses resource names that are not -dev resources', () => {
    expect(() => loadWipeConfig({ ...base, WIPE_UPLOADS_BUCKET: 'parimaan-uploads-prod' })).toThrow(
      /-dev/,
    );
  });

  it('has no default for the expected account, pool name or db host (fail closed)', () => {
    for (const name of [
      'WIPE_EXPECTED_ACCOUNT_ID',
      'WIPE_EXPECTED_POOL_NAME',
      'WIPE_EXPECTED_DB_HOST',
      'WIPE_EXPECTED_DB_NAME',
    ]) {
      expect(() => loadWipeConfig({ ...base, [name]: undefined })).toThrow(name);
      expect(() => loadWipeConfig({ ...base, [name]: '' })).toThrow(name);
    }
  });

  it('requires the expected account id to be 12 digits', () => {
    expect(() => loadWipeConfig({ ...base, WIPE_EXPECTED_ACCOUNT_ID: 'dev' })).toThrow(/12 digits/);
  });

  it('exposes the expected target values', () => {
    const config = loadWipeConfig(base);
    expect(config.expected).toEqual({
      accountId: '123456789012',
      poolName: 'parimaan-dev',
      dbHost: 'db.dev.rds.test',
      dbName: 'parimaan',
    });
  });

  describe('connection URL hardening (N1)', () => {
    const vectors = [
      '?host=other.example',
      '?hostaddr=10.0.0.1',
      '?ssl=0',
      '?sslmode=disable',
      '?sslrootcert=/tmp/ca.pem',
      '?port=5433',
      '?options=-c%20search_path%3Devil',
      '?uselibpqcompat=true',
      '?application_name=x',
    ];
    it.each(vectors)('rejects a query string (%s) without echoing credentials', (query) => {
      const url = `postgres://u:secretpw@localhost:5432/parimaan${query}`;
      try {
        loadWipeConfig({ ...base, WIPE_DATABASE_URL: url });
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toMatch(/query/i);
        expect((error as Error).message).not.toContain('secretpw');
      }
    });

    it('rejects a bare "?" and a fragment', () => {
      expect(() =>
        loadWipeConfig({ ...base, WIPE_DATABASE_URL: 'postgres://u:p@localhost:5432/parimaan?' }),
      ).toThrow(/query/i);
      expect(() =>
        loadWipeConfig({ ...base, WIPE_DATABASE_URL: 'postgres://u:p@localhost:5432/parimaan#x' }),
      ).toThrow(/fragment/i);
    });

    it('rejects a non-postgres scheme', () => {
      expect(() =>
        loadWipeConfig({ ...base, WIPE_DATABASE_URL: 'http://u:p@localhost:5432/parimaan' }),
      ).toThrow(/postgres/);
    });

    it('requires a database name in the URL', () => {
      expect(() =>
        loadWipeConfig({ ...base, WIPE_DATABASE_URL: 'postgres://u:p@localhost:5432' }),
      ).toThrow(/database name/);
    });

    it('exposes the parsed connection parts and never the raw URL', () => {
      const config = loadWipeConfig({
        ...base,
        WIPE_DATABASE_URL: 'postgres://adm%40in:p%2Fw@localhost:6543/parimaan',
      });
      expect(config.database).toEqual({
        host: 'localhost',
        port: 6543,
        user: 'adm@in',
        password: 'p/w',
        name: 'parimaan',
      });
      expect('databaseUrl' in config).toBe(false);
    });

    it('defaults the port to 5432', () => {
      expect(loadWipeConfig(base).database.port).toBe(5432);
    });

    it('refuses ambient libpq PG* environment variables that pg would fall back to', () => {
      expect(() => loadWipeConfig({ ...base, PGOPTIONS: '-c search_path=evil' })).toThrow(/PGOPTIONS/);
      expect(() => loadWipeConfig({ ...base, PGSSLMODE: 'disable' })).toThrow(/PGSSLMODE/);
    });
  });

  it('uses the servername override as the effective db host (SSM port-forward)', () => {
    const config = loadWipeConfig(base);
    expect(config.dbHost).toBe('db.dev.rds.test');
    expect(config.dbServername).toBe('db.dev.rds.test');
    const direct = loadWipeConfig({
      ...base,
      WIPE_DATABASE_SERVERNAME: undefined,
      WIPE_DATABASE_URL: 'postgres://u:p@db.dev.rds.test:5432/parimaan',
    });
    expect(direct.dbHost).toBe('db.dev.rds.test');
    expect(direct.dbServername).toBeUndefined();
  });

  it('rejects sslmode in the URL, without echoing the URL', () => {
    const url = 'postgres://u:secretpw@localhost:5432/parimaan?sslmode=disable';
    try {
      loadWipeConfig({ ...base, WIPE_DATABASE_URL: url });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/sslmode/);
      expect((error as Error).message).not.toContain('secretpw');
    }
  });

  it('rejects an unparseable URL without echoing it', () => {
    try {
      loadWipeConfig({ ...base, WIPE_DATABASE_URL: 'not a url secretpw' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('secretpw');
    }
  });

  it('names every missing variable without printing values', () => {
    expect(() => loadWipeConfig({ WIPE_ENV: 'dev' })).toThrow(/WIPE_USER_POOL_ID/);
  });
});
