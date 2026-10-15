import { createHash } from 'node:crypto';
import { NORMALISER_VERSION } from '../domain/ingredientCatalog.js';
import type { CatalogEntry } from '../domain/ingredientCatalog.js';
import type { CatalogBundle, UnitConversion } from './buildBundle.js';
import ingredientsJson from './data/ingredients.json' with { type: 'json' };
import conversionsJson from './data/conversions.json' with { type: 'json' };

/**
 * The committed catalog data. Statically imported so esbuild inlines it into
 * the migration-runner Lambda bundle (no runtime file reads). Regenerate with
 * `pnpm --filter ./api catalog:build`; `bundle.sync.test.ts` guards drift.
 */
export const catalogBundle: CatalogBundle = {
  ingredients: ingredientsJson as unknown as CatalogEntry[],
  conversions: conversionsJson as unknown as UnitConversion[],
};

/**
 * sha256 over the bundle plus the normaliser version (alias keys are derived
 * at sync time, so a normaliser change must also re-sync). The deploy-time
 * sync skips when the stored hash equals this value.
 */
export const catalogContentHash = (bundle: CatalogBundle): string =>
  createHash('sha256')
    .update(JSON.stringify({ v: NORMALISER_VERSION, bundle }))
    .digest('hex');
