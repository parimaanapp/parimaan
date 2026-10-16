/**
 * Adds the curated recipes an EXISTING household is missing (the corpus grew
 * after the household was created). New households get the full corpus at
 * `createHousehold`; this closes the gap for older ones. See
 * recipes/README.md and docs/catalog/README.md.
 *
 *   pnpm --filter ./api recipes:topup                # dry run (default, read-only)
 *   pnpm --filter ./api recipes:topup -- --execute   # write, one transaction per household
 *
 * Idempotent: a recipe the household already has (same title and role) is
 * skipped, so re-running adds nothing. Each household is locked with an
 * advisory lock while it is processed.
 *
 * Configuration comes from the environment only (no secret is printed):
 *   PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD   required; the role must bypass RLS
 *   PGSERVERNAME                                  optional TLS server name (SSM port-forward to RDS)
 * The ingredient catalog must already be synced (it is read from the database).
 */
import { Pool } from 'pg';
import { formatTopUpReport, topUpCuratedRecipes } from '../src/catalog/topUpCuratedRecipes.js';
import { getCuratedRecipesFromCorpus } from '../src/curatedRecipes.js';
import { createCanonicaliser } from '../src/domain/canonicaliseIngredient.js';
import { loadCatalog } from '../src/repositories/catalogRepository.js';
import { readPgConfig } from './pgEnvConfig.js';

const main = async (): Promise<void> => {
  const execute = process.argv.includes('--execute');
  const config = readPgConfig(process.env);
  // Explicit parts only, never a connection string (its parameters would override these).
  const pool = new Pool({ ...config, max: 2 });
  try {
    const snapshot = await loadCatalog(pool);
    if (snapshot.entries.length === 0) {
      throw new Error('The ingredient catalog is empty; run the deploy-time catalog sync first.');
    }
    const canonicaliser = createCanonicaliser({ index: snapshot.index, lookup: snapshot.conversionLookup });
    const report = await topUpCuratedRecipes({
      pool,
      recipes: getCuratedRecipesFromCorpus(),
      canonicaliser,
      execute,
    });
    process.stdout.write(`${formatTopUpReport(report)}\n`);
    if (!execute) {
      process.stdout.write('Re-run with --execute to apply.\n');
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected error'}\n`);
  process.exitCode = 1;
});
