import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RunnerOption } from 'node-pg-migrate';
import { runner } from 'node-pg-migrate';

/**
 * node-pg-migrate's own `MigrationDirection` and `RunMigration` types aren't
 * part of its public top-level export list (verified against the installed
 * v9.0.0 `dist/bundle/index.d.ts` — only `runner`, `RunnerOption`,
 * `Migration`, and `MigrationBuilder` are re-exported), so both are derived
 * here from `runner`'s own signature rather than imported directly.
 */
type MigrationDirection = RunnerOption['direction'];
type RunMigrationResult = Awaited<ReturnType<typeof runner>>;

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to `api/migrations/`, resolved relative to this module so it
 * works the same whether invoked from source (ts-node/vitest) or a compiled
 * build that preserves this file's relative position under `api/` —
 * `<api package root>/migrations`, regardless of cwd. Not yet verified
 * against an esbuild-bundled entrypoint (this package has no bundle/deploy
 * script yet): a single-file bundle would flatten this path, and
 * node-pg-migrate loads migration files from disk at runtime rather than via
 * static import, so `migrations/` would also need explicit copying into
 * whatever artifact runs `runMigrations`. Verify this end-to-end before
 * building the deploy-time migration Lambda/script this module is meant for.
 */
export const migrationsDir = resolve(currentDir, '../../migrations');

/**
 * The table node-pg-migrate uses to track which migrations have already run.
 * Named explicitly (rather than relying on the library default) so it's
 * obvious in a `\dt` listing what it's for.
 */
const migrationsTable = 'pgmigrations';

/**
 * Runs all pending migrations (or reverses them) against the given Postgres
 * connection. Thin wrapper around node-pg-migrate's programmatic `runner()`
 * API so callers (tests, and later a deploy-time migration Lambda/script)
 * don't need to know node-pg-migrate's option shape.
 */
export const runMigrations = async (
  databaseUrl: string,
  direction: MigrationDirection = 'up',
): Promise<RunMigrationResult> =>
  runner({
    databaseUrl,
    dir: migrationsDir,
    direction,
    migrationsTable,
    count: Infinity,
  });
