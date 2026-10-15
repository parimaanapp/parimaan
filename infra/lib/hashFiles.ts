import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Deterministic sha256 over a set of files (name + length + content, sorted
 * by path so listing order never matters). Used as a CloudFormation
 * `CustomResource` property so a change to the bundled ingredient catalog
 * re-invokes the migration runner, which then re-syncs it (the sync itself is
 * gated again by its own stored content hash).
 */
export const hashFiles = (paths: readonly string[]): string => {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const content = readFileSync(path);
    hash.update(basename(path));
    hash.update(String(content.length));
    hash.update(content);
  }
  return hash.digest('hex');
};
