import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashMigrationsDir } from '../../lib/hashMigrationsDir';

describe('hashMigrationsDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hash-migrations-dir-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces the same hash for the same file contents', () => {
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    writeFileSync(join(dir, '002_b.ts'), 'up 2');

    expect(hashMigrationsDir(dir)).toBe(hashMigrationsDir(dir));
  });

  it('changes when a migration file\'s content changes', () => {
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    const before = hashMigrationsDir(dir);

    writeFileSync(join(dir, '001_a.ts'), 'up 1 changed');
    const after = hashMigrationsDir(dir);

    expect(after).not.toBe(before);
  });

  it('changes when a migration file is added', () => {
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    const before = hashMigrationsDir(dir);

    writeFileSync(join(dir, '002_b.ts'), 'up 2');
    const after = hashMigrationsDir(dir);

    expect(after).not.toBe(before);
  });

  it('changes when a migration file is removed', () => {
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    writeFileSync(join(dir, '002_b.ts'), 'up 2');
    const before = hashMigrationsDir(dir);

    rmSync(join(dir, '002_b.ts'));
    const after = hashMigrationsDir(dir);

    expect(after).not.toBe(before);
  });

  it('is independent of filesystem creation order (sorted by filename)', () => {
    writeFileSync(join(dir, '002_b.ts'), 'up 2');
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    const orderB = hashMigrationsDir(dir);

    const dir2 = mkdtempSync(join(tmpdir(), 'hash-migrations-dir-test-'));
    try {
      writeFileSync(join(dir2, '001_a.ts'), 'up 1');
      writeFileSync(join(dir2, '002_b.ts'), 'up 2');
      const orderA = hashMigrationsDir(dir2);

      expect(orderA).toBe(orderB);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('ignores non-.ts files in the directory', () => {
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    const before = hashMigrationsDir(dir);

    writeFileSync(join(dir, 'README.md'), 'not a migration');
    const after = hashMigrationsDir(dir);

    expect(after).toBe(before);
  });

  it('returns a 64-character hex sha256 digest', () => {
    writeFileSync(join(dir, '001_a.ts'), 'up 1');
    expect(hashMigrationsDir(dir)).toMatch(/^[0-9a-f]{64}$/);
  });
});
