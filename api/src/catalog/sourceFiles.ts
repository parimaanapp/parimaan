import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Repo-relative locations used by `catalog:build` and the sync test only.
 * Never imported by Lambda code: the deployed artefact reads the committed
 * JSON via a static import (`bundle.ts`), which esbuild inlines.
 */
export const CATALOG_SOURCE_FILES = {
  ingredients: resolve(here, '../../../docs/catalog/ingredients.csv'),
  conversions: resolve(here, '../../../docs/catalog/conversions.csv'),
} as const;

export const CATALOG_BUNDLE_FILES = {
  ingredients: resolve(here, 'data/ingredients.json'),
  conversions: resolve(here, 'data/conversions.json'),
} as const;
