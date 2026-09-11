import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';

const thisDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Regression test for a real bug caught by W16 S6's live-AWS verification:
 * `resolveCuratedRecipesDir` (this module's own path-resolution helper)
 * used `import.meta.url` to locate itself on disk. Every local test runs
 * this module as genuine ESM (Vitest), where `import.meta.url` is always a
 * real value — so every test in `curatedRecipes.test.ts` passed locally.
 * But `infra/stacks/api-stack.ts`'s `NodejsFunction` bundles the deployed
 * Lambda to CommonJS via esbuild (confirmed by inspecting the synthesized
 * asset: `"use strict"` plus a `var import_meta = {}` stub) — esbuild does
 * NOT populate `import_meta.url` with a real value in CJS output, so
 * `import.meta.url` was `undefined` in the actual deployed Lambda, and
 * `new URL('.', undefined)` threw `TypeError: Invalid URL` on every real
 * `createHousehold` invocation. This was only discoverable by actually
 * invoking the deployed Lambda — no unit test, `tsc`, lint, or CDK synth
 * check would have caught it, because none of them execute the bundled
 * artifact's runtime behavior.
 *
 * This test closes that gap for good: it bundles `curatedRecipes.ts` with
 * esbuild using the SAME format/platform CDK's `NodejsFunction` uses
 * (`format: 'cjs'`, `platform: 'node'`, `bundle: true`), stages a copy of
 * the real `recipes/` directory next to the bundle output (mirroring
 * `api-stack.ts`'s own `afterBundling` copy step), and then actually
 * `require()`s and executes the bundled output — not the source module —
 * asserting it resolves the real 53-file corpus without throwing.
 */
describe('curatedRecipes.ts — bundled-Lambda (CJS) shape', () => {
  let outDir: string;

  afterEach(async () => {
    if (outDir) {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('resolves and reads the real recipes/ corpus when bundled to CJS, matching how CDK actually bundles this Lambda', async () => {
    outDir = await mkdtemp(join(tmpdir(), 'parimaan-curated-recipes-bundle-'));
    const outfile = join(outDir, 'index.js');

    await esbuild.build({
      entryPoints: [join(thisDir, 'curatedRecipes.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      logLevel: 'error',
    });

    // Mirrors `infra/stacks/api-stack.ts`'s `commandHooks.afterBundling`
    // copy step — the real `recipes/` directory lands next to the bundled
    // `index.js` in the deployed Lambda's asset root.
    const repoRoot = join(thisDir, '..', '..');
    await cp(join(repoRoot, 'recipes'), join(outDir, 'recipes'), { recursive: true });

    const require = createRequire(import.meta.url);
    // Bust Node's CJS require cache in case another test bundled to the
    // same path in a prior run within this process.
    delete require.cache[require.resolve(outfile)];
    const bundled = require(outfile) as {
      getCuratedRecipesFromCorpus: () => unknown[];
    };

    const recipes = bundled.getCuratedRecipesFromCorpus();
    expect(recipes).toHaveLength(53);
  });
});
