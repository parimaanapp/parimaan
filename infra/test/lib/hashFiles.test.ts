import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashFiles } from '../../lib/hashFiles';

describe('hashFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hash-files-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a stable sha256 hex digest for the same contents', () => {
    const a = join(dir, 'a.json');
    writeFileSync(a, '[1]');
    expect(hashFiles([a])).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFiles([a])).toBe(hashFiles([a]));
  });

  it('changes when a file changes', () => {
    const a = join(dir, 'a.json');
    writeFileSync(a, '[1]');
    const before = hashFiles([a]);
    writeFileSync(a, '[2]');
    expect(hashFiles([a])).not.toBe(before);
  });

  it('is independent of the order paths are listed in', () => {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, 'A');
    writeFileSync(b, 'B');
    expect(hashFiles([a, b])).toBe(hashFiles([b, a]));
  });

  it('differs when content moves between files', () => {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, 'AB');
    writeFileSync(b, '');
    const first = hashFiles([a, b]);
    writeFileSync(a, 'A');
    writeFileSync(b, 'B');
    expect(hashFiles([a, b])).not.toBe(first);
  });

  it('throws when a file is missing rather than hashing nothing', () => {
    expect(() => hashFiles([join(dir, 'missing.json')])).toThrow();
  });
});
