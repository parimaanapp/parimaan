/**
 * One-off, idempotent backfill (Build B, B2b): canonicalises existing
 * households' recipe ingredients and pantry rows through the ingredient
 * catalog (sets `ingredient_id` / `catalog_match`, rewrites names and units
 * the way the write path now does). See docs/catalog/README.md.
 *
 *   pnpm --filter ./api catalog:backfill                # dry run (default, read-only)
 *   pnpm --filter ./api catalog:backfill -- --execute   # write, in one transaction
 *
 * Configuration comes from the environment only (no secret is printed):
 *   PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD   required; the role must bypass RLS
 *   PGSERVERNAME                                  optional TLS server name (SSM port-forward to RDS)
 * Remote hosts are verified against the RDS global CA bundle; localhost is not
 * TLS-wrapped. The catalog must already be synced (it is read from the
 * database, not from the bundled JSON).
 */
import { Pool } from 'pg';
import { runIngredientBackfill, formatBackfillReport } from '../src/catalog/backfillIngredients.js';
import { createCanonicaliser } from '../src/domain/canonicaliseIngredient.js';
import { RDS_GLOBAL_BUNDLE_CA } from '../src/db/rdsGlobalBundleCa.js';
import { loadCatalog } from '../src/repositories/catalogRepository.js';

const REQUIRED = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

const readConfig = (env: NodeJS.ProcessEnv) => {
  const missing = REQUIRED.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  const host = env['PGHOST'] as string;
  const port = Number(env['PGPORT']);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PGPORT must be a positive integer.');
  }
  const servername = (env['PGSERVERNAME'] ?? '').trim();
  return {
    host,
    port,
    database: env['PGDATABASE'] as string,
    user: env['PGUSER'] as string,
    password: env['PGPASSWORD'] as string,
    ssl: LOCAL_HOSTS.has(host)
      ? false
      : {
          rejectUnauthorized: true,
          ca: RDS_GLOBAL_BUNDLE_CA,
          ...(servername === '' ? {} : { servername }),
        },
  };
};

const main = async (): Promise<void> => {
  const execute = process.argv.includes('--execute');
  const config = readConfig(process.env);
  // Explicit parts only, never a connection string (its parameters would override these).
  const pool = new Pool({ ...config, max: 2 });
  try {
    const snapshot = await loadCatalog(pool);
    if (snapshot.entries.length === 0) {
      throw new Error('The ingredient catalog is empty; run the deploy-time catalog sync first.');
    }
    const canonicaliser = createCanonicaliser({ index: snapshot.index, lookup: snapshot.conversionLookup });
    const client = await pool.connect();
    try {
      const report = await runIngredientBackfill(client, canonicaliser, { execute });
      process.stdout.write(`${formatBackfillReport(report)}\n`);
      if (!execute) {
        process.stdout.write('Re-run with --execute to apply.\n');
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected error'}\n`);
  process.exitCode = 1;
});
