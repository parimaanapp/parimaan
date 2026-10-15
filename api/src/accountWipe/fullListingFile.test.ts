import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFullListingFile } from './fullListingFile.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wipe-listing-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openFullListingFile (L2)', () => {
  it('creates the file exclusively with mode 0600 and writes the content', () => {
    const path = join(dir, 'listing.json');
    const file = openFullListingFile(path);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    file.write('{"a":1}');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}');
  });

  it('refuses an existing file and leaves it untouched', () => {
    const path = join(dir, 'listing.json');
    writeFileSync(path, 'keep me');
    expect(() => openFullListingFile(path)).toThrow(/exist/i);
    expect(readFileSync(path, 'utf8')).toBe('keep me');
  });

  it('refuses a symlink (even a dangling one) and does not write through it', () => {
    const target = join(dir, 'target.txt');
    const link = join(dir, 'link.json');
    symlinkSync(target, link);
    expect(() => openFullListingFile(link)).toThrow(/exist|symlink/i);
    expect(existsSync(target)).toBe(false);
  });

  it('refuses when the parent directory does not exist', () => {
    expect(() => openFullListingFile(join(dir, 'nope', 'listing.json'))).toThrow(/--full-listing/);
  });

  it('discard removes the file this run created', () => {
    const path = join(dir, 'listing.json');
    const file = openFullListingFile(path);
    file.discard();
    expect(existsSync(path)).toBe(false);
  });
});
