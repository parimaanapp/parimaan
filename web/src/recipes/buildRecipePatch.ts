import type { Recipe, RecipeFormValues, RecipeIngredientInput, RecipePatchInput } from './types';

const normalizedDescription = (recipe: Recipe): string => recipe.description ?? '';
const normalizedCuisineTier2 = (recipe: Recipe): string => recipe.cuisineTier2 ?? '';

const ingredientsEqual = (a: RecipeIngredientInput[], b: RecipeIngredientInput[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const dietaryTagsEqual = (a: Recipe['dietaryTags'], b: Recipe['dietaryTags']): boolean =>
  a.length === b.length && a.every((tag, index) => tag === b[index]);

const stepsEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((step, index) => step === b[index]);

const toIngredientInputs = (recipe: Recipe): RecipeIngredientInput[] =>
  recipe.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    category: ingredient.category,
    notes: ingredient.notes,
    isStaple: ingredient.isStaple,
  }));

/** The text/description-shaped fields — split out so no single function's own branch count grows past this codebase's `complexity` budget. */
const textFieldsPatch = (initial: Recipe, current: RecipeFormValues): RecipePatchInput => ({
  ...(current.title !== initial.title && { title: current.title }),
  ...(current.description !== normalizedDescription(initial) && { description: current.description }),
  ...(current.cuisineTier2 !== normalizedCuisineTier2(initial) && { cuisineTier2: current.cuisineTier2 }),
});

/** The nullable-number fields, where a `null` current value means "not yet chosen", never "clear it". */
const numericFieldsPatch = (initial: Recipe, current: RecipeFormValues): RecipePatchInput => ({
  ...(current.servings !== null && current.servings !== initial.servings && { servings: current.servings }),
  ...(current.prepMin !== null && current.prepMin !== initial.prepMin && { prepMin: current.prepMin }),
  ...(current.cookMin !== null && current.cookMin !== initial.cookMin && { cookMin: current.cookMin }),
});

/** The nullable-enum fields — same "`null` means not yet chosen" rule as `numericFieldsPatch`, split out to keep each function's own complexity low. */
const enumFieldsPatch = (initial: Recipe, current: RecipeFormValues): RecipePatchInput => ({
  ...(current.cuisineTier1 !== null &&
    current.cuisineTier1 !== initial.cuisineTier1 && { cuisineTier1: current.cuisineTier1 }),
  ...(current.role !== null && current.role !== initial.role && { role: current.role }),
});

/** The list-shaped fields — `dietaryTags`/`ingredients`/`steps` each replace-whole-list-or-omit. */
const listFieldsPatch = (initial: Recipe, current: RecipeFormValues): RecipePatchInput => ({
  ...(!dietaryTagsEqual(current.dietaryTags, initial.dietaryTags) && { dietaryTags: current.dietaryTags }),
  ...(!ingredientsEqual(current.ingredients, toIngredientInputs(initial)) && {
    ingredients: current.ingredients,
  }),
  ...(!stepsEqual(current.steps, initial.steps) && { steps: current.steps }),
});

/**
 * Builds a genuine partial patch for `Mutation.updateRecipe`: compares
 * `current` against `initial` (the recipe as loaded) and includes ONLY the
 * keys that actually differ — an unchanged field is never present on the
 * returned object, matching `RecipePatchInput`'s "absent = unchanged"
 * contract exactly (RED test 3).
 */
export const buildRecipePatch = (initial: Recipe, current: RecipeFormValues): RecipePatchInput => ({
  ...textFieldsPatch(initial, current),
  ...numericFieldsPatch(initial, current),
  ...enumFieldsPatch(initial, current),
  ...listFieldsPatch(initial, current),
});
