import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { recipeInputSchema } from '../src/validation/createRecipe.js';
import { recipeIngredientInputSchema } from '../src/validation/recipeShared.js';

/**
 * W15 §21.2.2 D2 — a validation script, not a hand-maintained JSON Schema
 * file, checks every curated recipe JSON before it's considered checked in.
 * `curatedRecipeInputSchema` below REUSES `recipeInputSchema`
 * (`api/src/validation/createRecipe.ts`) — the exact same schema
 * `Mutation.createRecipe` validates its own `RecipeInput` argument against
 * — rather than re-declaring `RecipeRole`/`CuisineTier1`/`DietaryTag` as new
 * string literal unions here. That's the whole point of D2's design: a
 * future schema change that adds/renames an enum value is caught by a
 * TypeScript error in this file (an unrecognised value flowing out of
 * `RECIPE_ROLE_VALUES` etc.), not silently allowed to drift, because this
 * script has no enum values of its own to fall out of sync.
 *
 * The only thing this file adds on top of `recipeInputSchema` is
 * curated-content-specific strictness `RecipeInput` deliberately doesn't
 * enforce (`recipeShared.ts`'s own comment: a live-authored recipe with no
 * ingredients/steps yet is a valid in-progress state) — a *checked-in*
 * curated recipe must have at least one ingredient and one non-empty step.
 */
const curatedRecipeInputSchema = recipeInputSchema.extend({
  ingredients: z
    .array(recipeIngredientInputSchema)
    .min(1, 'ingredients must contain at least one item'),
  steps: z
    .array(z.string().trim().min(1, 'each step must not be empty'))
    .min(1, 'steps must contain at least one item'),
});

export type CuratedRecipeInput = z.infer<typeof curatedRecipeInputSchema>;

/**
 * A directory-cuisine rule: any file physically located under
 * `recipesDirSegment` must carry `cuisineTier1: requiredCuisineTier1`
 * specifically, not merely any valid `CuisineTier1` member (§21.2.1 D1 —
 * "carried explicitly per file rather than inferred from the directory
 * path, so a file is self-describing if it's ever moved or read in
 * isolation").
 */
interface CuisineDirRule {
  readonly dirSegment: string;
  readonly requiredCuisineTier1: string;
}

/**
 * W16 §22.2.1 D1 — a small table of `{ dirSegment, requiredCuisineTier1 }`
 * pairs, one row per curated-recipe directory, rather than a hardcoded
 * per-directory `if` branch. Adding a hypothetical third cuisine directory
 * is one new row here, not a third copy-pasted branch in
 * `checkCuisineDirRule` below. No leading separator on each `dirSegment` —
 * a `filePath` passed in by a caller (test fixtures included) may be
 * relative (`recipes/north-indian/dal-tadka.json`) or absolute
 * (`/.../recipes/north-indian/dal-tadka.json`); matching the bare
 * `recipes${sep}<dir>${sep}` segment catches both.
 */
const CUISINE_DIR_RULES: readonly CuisineDirRule[] = [
  { dirSegment: `recipes${sep}north-indian${sep}`, requiredCuisineTier1: 'north_indian' },
  { dirSegment: `recipes${sep}south-indian${sep}`, requiredCuisineTier1: 'south_indian' },
];

/**
 * Finds the directory-cuisine rule (if any) that applies to `filePath`, and
 * checks the already-schema-validated `cuisineTier1` against it. Returns
 * `null` when the rule is satisfied (or no rule applies to this path).
 */
function checkCuisineDirRule(filePath: string, cuisineTier1: string | null | undefined): string | null {
  const rule = CUISINE_DIR_RULES.find(({ dirSegment }) => filePath.includes(dirSegment));
  if (!rule || cuisineTier1 === rule.requiredCuisineTier1) {
    return null;
  }
  return `cuisineTier1: must be "${rule.requiredCuisineTier1}" for files under ${rule.dirSegment.split(sep).join('/')} (got ${JSON.stringify(
    cuisineTier1 ?? null,
  )})`;
}

export interface RecipeFileValidationResult {
  readonly filePath: string;
  readonly success: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates one already-parsed recipe JSON payload against
 * `curatedRecipeInputSchema`, plus the directory-based rules the shared
 * schema has no way to express on its own — see `CUISINE_DIR_RULES` — each
 * of which requires a file physically located under a given curated-recipe
 * directory to carry the matching `cuisineTier1` value specifically, not
 * merely any valid `CuisineTier1` member (§21.2.1 D1 — "carried explicitly
 * per file rather than inferred from the directory path, so a file is
 * self-describing if it's ever moved or read in isolation").
 */
export function validateCuratedRecipe(filePath: string, data: unknown): RecipeFileValidationResult {
  const parsed = curatedRecipeInputSchema.safeParse(data);
  if (!parsed.success) {
    return {
      filePath,
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }

  const dirRuleError = checkCuisineDirRule(filePath, parsed.data.cuisineTier1);
  if (dirRuleError) {
    return { filePath, success: false, errors: [dirRuleError] };
  }

  return { filePath, success: true, errors: [] };
}

/**
 * Recursively collects every `*.json` file under `dir`. No `glob`/
 * `fast-glob` dependency — this repo's `engines.node` pins `>=20.0.0
 * <21.0.0` (root `package.json`), predating `fs.glob`/`fs.promises.glob`
 * (Node 22+), and the recipe tree is shallow enough that a hand-rolled walk
 * needs no library.
 */
export function findJsonFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory doesn't exist yet — treated as "zero files", not an error,
    // so this script stays green before `recipes/north-indian/` exists.
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...findJsonFiles(entryPath));
    } else if (stats.isFile() && entry.endsWith('.json')) {
      files.push(entryPath);
    }
  }
  return files;
}

/** `recipes/` lives at the repo root, two directories above `api/scripts/`. */
export function repoRecipesDir(): string {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  return join(scriptDir, '..', '..', 'recipes');
}

/**
 * Reads and validates every `*.json` file under `recipesDir`. This is the
 * one function `validateCuratedRecipes.test.ts` calls against the real
 * `recipes/` directory on disk — per D2's own "a check that isn't wired
 * into the test suite doesn't get run" posture, `validate:recipes`
 * (`api/package.json`) runs this file through Vitest rather than as a
 * separate CLI entry point, so there's no second, unexercised "run
 * directly with node" code path to keep in sync with this one.
 */
export function validateAllCuratedRecipes(recipesDir: string): RecipeFileValidationResult[] {
  return findJsonFiles(recipesDir).map((filePath) => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { filePath, success: false, errors: [`invalid JSON: ${message}`] };
    }
    return validateCuratedRecipe(filePath, raw);
  });
}
