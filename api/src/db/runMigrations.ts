import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RunnerOption } from 'node-pg-migrate';
import { runner } from 'node-pg-migrate';
import { createRedactingLogger } from './redactingLogger.js';

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
 *
 * `migrationsDirOverride` lets a caller point at a different directory than
 * the `migrationsDir` constant above — needed once this runs from an
 * esbuild-bundled Lambda asset, where `migrations/` is copied to some other
 * location within the bundle rather than sitting next to this file. Defaults
 * to `migrationsDir` so every existing caller (tests included) is unaffected.
 *
 * `secretsToRedact` is passed through to a wrapping logger (see
 * `redactingLogger.ts`) rather than to `runner()`'s own `verbose` flag —
 * node-pg-migrate's default (non-verbose) logger already omits the SQL
 * text it runs, but its query-error path logs the failing statement's full
 * SQL **unconditionally**, verbose or not. A migration embedding a
 * plaintext secret directly in SQL (Postgres DDL has no bind-parameter
 * mechanism to avoid this — see `migrations/1787124517648_app-role.ts`)
 * would otherwise leak that secret to whatever this process's `console` is
 * wired to (CloudWatch, in the deploy-time Lambda) the moment the
 * statement fails for any reason. Callers that embed a secret in migration
 * SQL must pass it here. **Never pass `verbose: true` to this function's
 * underlying `runner()` call** against a real database — it would print
 * every statement's SQL text on success too, not just on failure.
 */
export const runMigrations = async (
  databaseUrl: string,
  direction: MigrationDirection = 'up',
  migrationsDirOverride?: string,
  secretsToRedact: readonly string[] = [],
): Promise<RunMigrationResult> =>
  runner({
    databaseUrl,
    dir: migrationsDirOverride ?? migrationsDir,
    direction,
    migrationsTable,
    count: Infinity,
    logger: createRedactingLogger(secretsToRedact),
  });
