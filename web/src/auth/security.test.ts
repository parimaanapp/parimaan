import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..'); // web/

/**
 * Mandatory security regression test (mirroring W18 S1's own secret-never-
 * literal test on the CloudFormation template) for D1/D2's own rule: the
 * web client's Secrets-Manager-fetched SECRET must never reach the browser.
 * This statically scans the real source tree rather than trusting the
 * `server-only` import by convention alone — an actual check, not an
 * assumption, per this slice's own explicit instruction.
 */

const TS_FILE_PATTERN = /\.(ts|tsx)$/;
const NODE_MODULES = 'node_modules';

const listSourceFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (entry === NODE_MODULES || entry === '.next' || entry.startsWith('.')) {
      return [];
    }
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    return TS_FILE_PATTERN.test(entry) ? [fullPath] : [];
  });
};

const isClientMarked = (content: string): boolean => content.trimStart().startsWith("'use client'") || content.trimStart().startsWith('"use client"');

describe('web client secret never reaches the browser', () => {
  // Test files themselves are never bundled into the shipped app — excluded
  // so a test's own source text (which necessarily names the very strings
  // it's checking for) can't produce a false self-match.
  const sourceFiles = listSourceFiles(join(webRoot, 'app'))
    .concat(listSourceFiles(join(webRoot, 'src')))
    .filter((path) => !/\.test\.tsx?$/.test(path));

  it('secrets.ts declares the server-only guard Next.js enforces at build/runtime', () => {
    const secretsSource = readFileSync(join(webRoot, 'src', 'auth', 'secrets.ts'), 'utf8');
    expect(secretsSource).toContain("import 'server-only'");
  });

  it('no "use client" file references the secret ARN env var or imports secrets.ts/getWebClientCredentials', () => {
    const offenders = sourceFiles.filter((path) => {
      const content = readFileSync(path, 'utf8');
      if (!isClientMarked(content)) {
        return false;
      }
      return (
        content.includes('WEB_CLIENT_CREDENTIALS_SECRET_ARN') ||
        content.includes('getWebClientCredentials') ||
        /from\s+['"].*secrets(\.js)?['"]/.test(content)
      );
    });

    expect(offenders).toEqual([]);
  });

  it('no source file logs the secret (no console.* call mentioning clientSecret)', () => {
    const offenders = sourceFiles.filter((path) => {
      const content = readFileSync(path, 'utf8');
      return /console\.(log|info|warn|error|debug)\([^)]*clientSecret/i.test(content);
    });

    expect(offenders).toEqual([]);
  });

  it('the secret never gets the NEXT_PUBLIC_ prefix Next.js uses to inline values into the client bundle', () => {
    const offenders = sourceFiles.filter((path) => readFileSync(path, 'utf8').includes('NEXT_PUBLIC_WEB_CLIENT'));

    expect(offenders).toEqual([]);
  });
});
