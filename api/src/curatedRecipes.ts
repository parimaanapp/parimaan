import type { RecipeInput } from './validation/createRecipe.js';

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
 * `api/scripts/validateCuratedRecipes.ts` already exports a
 * `CuratedRecipeInput` of its own, but it lives under `scripts/` — dev
 * tooling that imports FROM `src/` (see `tsconfig.json`'s comment on why
 * `scripts/` is a sibling include, not a `src/` dependency). Importing it
 * back INTO `src/` here would invert that boundary and pull a
 * `scripts/`-only module into the Lambda's runtime dependency graph, so
 * this file aliases `RecipeInput` directly instead of reaching for
 * `scripts/validateCuratedRecipes.ts`'s export.
 */
export type CuratedRecipeInput = RecipeInput;

/**
 * Injectable seam for `createHousehold`'s curated-recipe-list source
 * (W16 §22.3 S4) — tests inject a small fixture list; the real
 * implementation (reading/parsing all 50 curated JSON files from
 * `recipes/north-indian/` + `recipes/south-indian/`, bundled with the
 * Lambda at build time and cached module-level after first read, per
 * D2/S4's own "no new I/O dependency, read once at cold-start" design) is
 * WIRED IN W16 S5 — not this slice.
 */
export type GetCuratedRecipesFn = () => CuratedRecipeInput[];

/**
 * TODO(W16 S5): replace this with the real module that reads and parses
 * the 50 curated JSON files from `recipes/north-indian/` +
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
 */
export const getCuratedRecipesNotYetWired: GetCuratedRecipesFn = () => [];
