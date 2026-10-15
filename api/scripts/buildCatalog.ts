/**
 * `pnpm --filter ./api catalog:build`
 *
 * Regenerates api/src/catalog/data/{ingredients,conversions}.json from
 * docs/catalog/{ingredients,conversions}.csv. The JSON is committed; the test
 * `src/catalog/bundle.sync.test.ts` fails when it drifts from the CSV.
 * Pass `--check` to verify without writing (exit 1 when out of date).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildCatalogBundle, serialiseBundleFile } from '../src/catalog/buildBundle.js';
import { CATALOG_BUNDLE_FILES, CATALOG_SOURCE_FILES } from '../src/catalog/sourceFiles.js';

const readIfExists = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const main = (): number => {
  const check = process.argv.includes('--check');
  const bundle = buildCatalogBundle(
    readFileSync(CATALOG_SOURCE_FILES.ingredients, 'utf8'),
    readFileSync(CATALOG_SOURCE_FILES.conversions, 'utf8'),
  );
  const outputs: ReadonlyArray<readonly [string, string]> = [
    [CATALOG_BUNDLE_FILES.ingredients, serialiseBundleFile(bundle.ingredients)],
    [CATALOG_BUNDLE_FILES.conversions, serialiseBundleFile(bundle.conversions)],
  ];

  let stale = false;
  for (const [path, content] of outputs) {
    if (readIfExists(path) === content) {
      continue;
    }
    stale = true;
    if (!check) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
      process.stdout.write(`wrote ${path}\n`);
    } else {
      console.error(`out of date: ${path}`);
    }
  }
  process.stdout.write(
    `catalog: ${bundle.ingredients.length} ingredients, ${bundle.conversions.length} conversions${stale && !check ? ' (updated)' : ''}\n`,
  );
  return check && stale ? 1 : 0;
};

process.exitCode = main();
