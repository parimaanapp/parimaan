import type { IngredientCanonicaliser } from '../domain/canonicaliseIngredient.js';
import type { CuratedRecipeInput } from '../curatedRecipes.js';
import type { BulkRecipeInput } from '../repositories/recipeBulkRepository.js';
import type { InsertRecipeInput } from '../repositories/recipeRepository.js';
import { toRecipeIngredientFields } from './recipeIngredientInput.js';

/**
 * Builds the `insertRecipe` input for one curated recipe (W16 §22.2.3 D3,
 * §22.2.4 D4), mirroring `createRecipe.ts`'s own `toInsertRecipeInput` with
 * two columns FIXED rather than derived from caller input: `sourceType:
 * 'curated'` and `sourceUrl: null` (curated recipes carry no source URL).
 * `createdBy` is the household's own creator, never a sentinel user (D3).
 */
const toInsertCuratedRecipeInput = (
  householdId: string,
  input: CuratedRecipeInput,
  createdBy: string,
): InsertRecipeInput => ({
  householdId,
  sourceType: 'curated',
  sourceUrl: null,
  title: input.title,
  description: input.description ?? null,
  servings: input.servings ?? 4,
  prepMin: input.prepMin ?? null,
  cookMin: input.cookMin ?? null,
  cuisineTier1: input.cuisineTier1 ?? null,
  cuisineTier2: input.cuisineTier2 ?? null,
  dietaryTags: input.dietaryTags ?? [],
  role: input.role,
  // Not special-cased for seeded rows (D4): the same default as a manually created recipe.
  inRotation: input.inRotation ?? true,
  steps: input.steps,
  createdBy,
});

/**
 * One curated recipe as a batch item for `insertRecipesWithIngredients`, with
 * every ingredient canonicalised through the catalog (B2b). Shared by
 * `createHousehold` seeding and the existing-household top-up script, so both
 * write identical rows.
 */
export const toBulkCuratedRecipe = (
  householdId: string,
  recipe: CuratedRecipeInput,
  createdBy: string,
  canonicaliser: IngredientCanonicaliser,
): BulkRecipeInput => ({
  recipe: toInsertCuratedRecipeInput(householdId, recipe, createdBy),
  ingredients: recipe.ingredients.map((ingredient, index) => toRecipeIngredientFields(ingredient, index, canonicaliser)),
});
