import * as fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecipeInput } from './validation/createRecipe.js';
import { curatedRecipeInputSchema } from './validation/curatedRecipe.js';

/**
 * The shape of one curated recipe as seed data for `createHousehold`'s
 * curated-seeder step (W16 §22.2.2 D2). This is deliberately NOT a new
 * type: `RecipeInput` (`validation/createRecipe.ts`) already has the exact
 * field list the plan calls for (title, description, servings, prepMin,
 * cookMin, cuisineTier1, cuisineTier2, dietaryTags, role, ingredients,
 * steps) — it's the same JSON shape W15/W16's curated recipe files
 * already use (see `api/scripts/validateCuratedRecipes.ts`'s own
 * `curatedRecipeInputSchema`, which is `recipeInputSchema.extend(...)` for
 * the identical reason: reuse, don't re-declare). A plain alias here keeps
 * the seeder's own signature self-documenting without introducing a second
 * "recipe input" type for this module's callers to keep in sync.
 *
 * `validation/curatedRecipe.ts` (W16 S5) is where the ACTUAL runtime
 * validation schema lives now — shared by this module and
 * `api/scripts/validateCuratedRecipes.ts` — see that file's own doc for
 * why it had to move out of `scripts/` to be reusable here without
 * inverting the `scripts/` → `src/` import boundary.
 */
export type CuratedRecipeInput = RecipeInput;

/**
 * Injectable seam for `createHousehold`'s curated-recipe-list source
 * (W16 §22.3 S4) — tests inject a small fixture list; the real
 * implementation (below, `getCuratedRecipesFromCorpus`) reads/parses all
 * curated JSON files from `recipes/north-indian/` + `recipes/south-indian/`,
 * bundled with the Lambda at build time and cached module-level after
 * first read, per D2/S4's own "no new I/O dependency, read once at
 * cold-start" design.
 */
export type GetCuratedRecipesFn = () => CuratedRecipeInput[];

/**
 * TODO(W16 S5): replace this with the real module that reads and parses
 * the curated JSON files from `recipes/north-indian/` +
 * `recipes/south-indian/` at Lambda cold-start, caching the parsed result
 * in a module-level variable (read once, reuse — the same posture this
 * codebase already applies to other cold-start-loaded config). Until then,
 * this is `createHousehold`'s default for `getCuratedRecipes` whenever a
 * caller doesn't override it — deliberately an EMPTY list, not a throw.
 *
 * A throwing stub was considered (and is what W16 §22.3 S4's own plan text
 * floats as one option) but rejected here: `createHousehold` is this
 * codebase's single most foundational mutation, and every pre-existing
 * test in `createHousehold.test.ts` — plus every real caller in production
 * until S5 ships — invokes it WITHOUT overriding `getCuratedRecipes`. A
 * throwing default would turn a not-yet-wired seed source into "every new
 * household creation fails outright," exactly the highest-severity outcome
 * this slice's own risk callout warns against. An empty-list default keeps
 * `createHousehold`'s four pre-existing steps behaving identically to
 * before this slice (zero curated recipes seeded, same as before this
 * feature existed) until S5 substitutes the real corpus reader here.
 *
 * KEPT (not deleted) after S5 landed `getCuratedRecipesFromCorpus` below —
 * `createHousehold.test.ts`'s pre-existing tests and any other caller that
 * still wants the deliberately-empty behavior (e.g. a future isolated unit
 * test of the resolver's four original steps) can keep depending on it by
 * name; only `productionDeps` in `createHousehold.ts` changed to point at
 * the real reader instead.
 */
export const getCuratedRecipesNotYetWired: GetCuratedRecipesFn = () => [];

/**
 * Recursively collects every `*.json` file under `dir`, sorted for
 * deterministic ordering across runs/platforms. Mirrors
 * `api/scripts/validateCuratedRecipes.ts`'s own `findJsonFiles` exactly
 * (same walk, same file-finding approach) rather than reusing that
 * function directly — `scripts/` is allowed to import from `src/`, never
 * the other way around (see `validation/curatedRecipe.ts`'s doc), so this
 * module cannot import `findJsonFiles` from `scripts/validateCuratedRecipes.ts`
 * without inverting that boundary. No `glob`/`fast-glob` dependency, for
 * the identical reason that file gives: this repo's `engines.node` predates
 * `fs.glob`/`fs.promises.glob`, and the recipe tree is shallow enough that
 * a hand-rolled walk needs no library.
 */
function findJsonFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of [...entries].sort()) {
    const entryPath = join(dir, entry);
    const stats = fs.statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...findJsonFiles(entryPath));
    } else if (stats.isFile() && entry.endsWith('.json')) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * Locates the `recipes/` directory this module reads from, trying
 * candidates in order and using the first that actually exists on disk:
 *
 * 1. Sibling to this module's own file — the BUNDLED Lambda shape.
 *    `NodejsFunction`'s esbuild bundling flattens `createHousehold.ts`'s
 *    entire dependency graph (this module included) into one output file
 *    at the asset root; `infra/stacks/api-stack.ts`'s
 *    `commandHooks.afterBundling` (W16 S5) copies `recipes/` into that
 *    same asset root directory, so "next to the bundle" is where it lands
 *    in a real deployment.
 * 2. Two directories up from this module's own file — the LOCAL
 *    dev/test/`tsx`/Vitest shape, where this file still lives at its
 *    source path `api/src/curatedRecipes.ts` (never bundled) and
 *    `recipes/` sits at the repo root, exactly the same depth
 *    `api/scripts/validateCuratedRecipes.ts`'s own `repoRecipesDir()`
 *    resolves via `join(scriptDir, '..', '..', 'recipes')`.
 *
 * Trying both (rather than hardcoding one) is what makes the exact same
 * compiled module work correctly in both the bundled-Lambda and
 * unbundled-local shapes without an environment variable or a build-time
 * path substitution — see `infra/stacks/api-stack.ts`'s own comment on
 * the `afterBundling` copy step for the packaging half of this design.
 */
function resolveCuratedRecipesDir(): string {
  const moduleDir = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [join(moduleDir, 'recipes'), join(moduleDir, '..', '..', 'recipes')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  throw new Error(
    `curatedRecipes: could not locate the curated recipes directory. Checked: ${candidates.join(', ')}`,
  );
}

/**
 * Reads every curated recipe JSON file off disk and validates each against
 * `curatedRecipeInputSchema` (`validation/curatedRecipe.ts` — the SAME
 * schema `api/scripts/validateCuratedRecipes.ts` checks every file against
 * before it's allowed to be checked in, reused here rather than
 * re-declared). FAILS LOUDLY: a malformed or unparseable file throws
 * immediately rather than being silently skipped — a malformed curated
 * file should never silently reduce the seeded set (W16 S5's own locked
 * constraint). In practice a malformed file should already have been
 * caught by `pnpm validate:recipes` in CI long before it ships; this is
 * the runtime's own last-line-of-defense check, not the primary one.
 */
function readAndValidateCuratedRecipes(recipesDir: string): CuratedRecipeInput[] {
  const filePaths = findJsonFiles(recipesDir);

  return filePaths.map((filePath) => {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`curatedRecipes: ${filePath} is not valid JSON: ${message}`);
    }

    const parsed = curatedRecipeInputSchema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`curatedRecipes: ${filePath} failed validation: ${details}`);
    }

    return parsed.data;
  });
}

/**
 * Module-level cache (W16 S5's own "read once, cache module-level" design)
 * — `null` means "not yet read this warm Lambda instance," never reset
 * within a process lifetime. A repeated `createHousehold` invocation on a
 * warm Lambda instance hits this cache instead of re-globbing/re-parsing
 * the filesystem every time.
 */
let cachedCuratedRecipes: CuratedRecipeInput[] | null = null;

/**
 * The real, production `GetCuratedRecipesFn` (W16 S5) — reads and parses
 * every curated recipe JSON file from `recipes/north-indian/` +
 * `recipes/south-indian/` (via `resolveCuratedRecipesDir`'s bundled/local
 * path resolution), validates each against the shared Zod schema, and
 * caches the result in `cachedCuratedRecipes` so repeated calls within the
 * same warm Lambda instance don't re-read the filesystem. Throws (rather
 * than returning a partial list) if any file is unparseable or invalid —
 * see `readAndValidateCuratedRecipes`'s own doc for why that's the
 * deliberate choice here, not a defect.
 */
export const getCuratedRecipesFromCorpus: GetCuratedRecipesFn = () => {
  if (cachedCuratedRecipes === null) {
    const recipesDir = resolveCuratedRecipesDir();
    cachedCuratedRecipes = readAndValidateCuratedRecipes(recipesDir);
  }
  return cachedCuratedRecipes;
};

// Exposed for `curatedRecipes.test.ts` only — resets the module-level cache
// between test cases that need a fresh read (e.g. to observe the
// re-read-vs-cached-call fs call counts in isolation from other tests in
// the same file, since the cache is otherwise process-lifetime).
export function __resetCuratedRecipesCacheForTests(): void {
  cachedCuratedRecipes = null;
}

/**
 * Exposed for `curatedRecipes.test.ts` only — exercises the exact same
 * read+validate(+throw-on-malformed) path `getCuratedRecipesFromCorpus`
 * uses internally, but against an arbitrary directory (a temp fixture with
 * a deliberately malformed file) instead of the real, resolved
 * `recipes/north-indian` + `recipes/south-indian` corpus, and WITHOUT
 * touching the module-level cache. `resolveCuratedRecipesDir` itself has
 * no override seam by design (it resolves relative to this module's own
 * compiled location, matching the real bundled-Lambda/local-dev path
 * resolution) — this function is what lets the malformed-file RED test
 * reach the throwing behavior without needing one.
 */
export function __loadCuratedRecipesFromDirForTests(recipesDir: string): CuratedRecipeInput[] {
  return readAndValidateCuratedRecipes(recipesDir);
}
