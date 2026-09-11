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
 * Repo-root-relative directory whose files must carry
 * `cuisineTier1: "north_indian"` (§21.2.1 D1). No leading separator — a
 * `filePath` passed in by a caller (test fixtures included) may be
 * relative (`recipes/north-indian/dal-tadka.json`) or absolute
 * (`/.../recipes/north-indian/dal-tadka.json`); matching the bare
 * `recipes${sep}north-indian${sep}` segment catches both.
 */
const NORTH_INDIAN_DIR_SEGMENT = `recipes${sep}north-indian${sep}`;

export interface RecipeFileValidationResult {
  readonly filePath: string;
  readonly success: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates one already-parsed recipe JSON payload against
 * `curatedRecipeInputSchema`, plus the one directory-based rule the shared
 * schema has no way to express on its own: a file physically located under
 * `recipes/north-indian/` must carry `cuisineTier1: "north_indian"`
 * specifically, not merely any valid `CuisineTier1` member (§21.2.1 D1 —
 * "carried explicitly per file rather than inferred from the directory
 * path, so a file is self-describing if it's ever moved or read in
 * isolation").
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

  const isUnderNorthIndian = filePath.includes(NORTH_INDIAN_DIR_SEGMENT);
  if (isUnderNorthIndian && parsed.data.cuisineTier1 !== 'north_indian') {
    return {
      filePath,
      success: false,
      errors: [
        `cuisineTier1: must be "north_indian" for files under recipes/north-indian/ (got ${JSON.stringify(
          parsed.data.cuisineTier1 ?? null,
        )})`,
      ],
    };
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
