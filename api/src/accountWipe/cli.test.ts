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

  it('names every missing variable without printing values', () => {
    expect(() => loadWipeConfig({ WIPE_ENV: 'dev' })).toThrow(/WIPE_USER_POOL_ID/);
  });
});
