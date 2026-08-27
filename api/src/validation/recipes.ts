import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
import { RECIPE_ROLE_VALUES } from '../domain/recipeRoles.js';

/**
 * Normalises a string (trim + lowercase) before the closed-enum check —
 * matches `RecipeRole`'s GraphQL enum value casing exactly, so a client
 * sending `"Breakfast"` or `" breakfast "` still matches rather than being
 * rejected as unknown. Unlike `pantryUnits.ts`/`pantryCategories.ts`'s
 * canonicalise-then-pass-through, an unnormalised match here is a
 * `ValidationError`, not silently accepted (E2E_MVP_PLAN.md §12.2.6, D4) —
 * `role` is a closed GraphQL enum, and an unrecognised persisted value
 * would fail to serialize the entire `Query.recipes` response, not just
 * this one field.
 */
// A cap well over the longest real enum value exists purely so a
// pathologically long string is rejected by shape before it reaches the
// trim/lowercase/`z.enum` chain — cheap defense-in-depth (security-reviewer
// flagged this slice's original lack of one), not a meaningful DoS vector
// on its own given AppSync's own payload limits.
const MAX_ENUM_INPUT_LENGTH = 64;

const normalizeThenEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.length <= MAX_ENUM_INPUT_LENGTH
        ? value.trim().toLowerCase()
        : value,
    z.enum(values),
  );

const recipeRoleSchema = normalizeThenEnum(RECIPE_ROLE_VALUES);

/**
 * Validates `Query.recipes`'s arguments. `role`/`isFavorite` are both
 * optional filters — `.nullish()`, not `.optional()`: a real AppSync/Ferry
 * client sends an unset nullable GraphQL argument as an explicit `null`,
 * not an absent key (the exact bug found and fixed in W5,
 * E2E_MVP_PLAN.md §11.5.5 — `Query.pantry` had the identical
 * `.optional()`-vs-`.nullish()` gap). Every W6 backend slice's tests must
 * exercise explicit `null`, not only `undefined`, per that lesson.
 */
export const recipesArgsSchema = z.object({
  householdId: householdIdSchema,
  role: recipeRoleSchema.nullish(),
  isFavorite: z.boolean().nullish(),
});

export type RecipesArgs = z.infer<typeof recipesArgsSchema>;
