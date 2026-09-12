/**
 * W18 S5's recipe types — hand-written to mirror `shared/schema.graphql`'s
 * `Recipe`/`RecipeInput`/`RecipePatchInput`/`RecipeDraft` types field-for-
 * field (no generated-types package exists yet, `shared/generated` is still
 * an empty placeholder). Kept in one small file so every other recipes
 * module imports the same shapes rather than re-declaring them.
 */

export type RecipeRole =
  | 'breakfast'
  | 'carb'
  | 'sabzi_dal'
  | 'accompaniment'
  | 'snack'
  | 'sweet'
  | 'drink';

export const RECIPE_ROLES: readonly RecipeRole[] = [
  'breakfast',
  'carb',
  'sabzi_dal',
  'accompaniment',
  'snack',
  'sweet',
  'drink',
];

export type CuisineTier1 = 'north_indian' | 'south_indian' | 'pan_india' | 'indo_chinese' | 'continental';

export const CUISINE_TIER1_VALUES: readonly CuisineTier1[] = [
  'north_indian',
  'south_indian',
  'pan_india',
  'indo_chinese',
  'continental',
];

export type DietaryTag = 'veg' | 'vegan' | 'jain' | 'eggetarian' | 'gluten_free' | 'dairy_free';

export const DIETARY_TAG_VALUES: readonly DietaryTag[] = [
  'veg',
  'vegan',
  'jain',
  'eggetarian',
  'gluten_free',
  'dairy_free',
];

export type RecipeSource = 'user' | 'url' | 'curated' | 'ai' | 'freeform_ai';

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  isStaple: boolean;
}

export interface RecipeIngredientInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category?: string | null;
  notes?: string | null;
  isStaple?: boolean | null;
}

export interface Recipe {
  id: string;
  householdId: string;
  sourceType: RecipeSource;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  servings: number;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: CuisineTier1 | null;
  cuisineTier2: string | null;
  dietaryTags: DietaryTag[];
  role: RecipeRole;
  inRotation: boolean;
  isFavorite: boolean;
  ingredients: RecipeIngredient[];
  steps: string[];
  createdAt: string;
  updatedAt: string;
}

/** Input for `Mutation.createRecipe` — `title`, `role`, `ingredients`, `steps` are required, everything else optional. */
export interface RecipeInput {
  title: string;
  description?: string | null;
  servings?: number | null;
  prepMin?: number | null;
  cookMin?: number | null;
  cuisineTier1?: CuisineTier1 | null;
  cuisineTier2?: string | null;
  dietaryTags?: DietaryTag[] | null;
  role: RecipeRole;
  inRotation?: boolean | null;
  ingredients: RecipeIngredientInput[];
  steps: string[];
}

/**
 * A partial patch for `Mutation.updateRecipe` — every key is genuinely
 * optional. An absent key means "leave unchanged"; an explicit `null` is
 * rejected server-side (never sent by this client). `ingredients`/`steps`
 * are the one exception: when present (even `[]`) they REPLACE the whole
 * list rather than patching entries — mirrored exactly from
 * `RecipePatchInput`'s own doc comment.
 */
export interface RecipePatchInput {
  title?: string;
  description?: string;
  servings?: number;
  prepMin?: number;
  cookMin?: number;
  cuisineTier1?: CuisineTier1;
  cuisineTier2?: string;
  dietaryTags?: DietaryTag[];
  role?: RecipeRole;
  inRotation?: boolean;
  ingredients?: RecipeIngredientInput[];
  steps?: string[];
}

export interface RecipeSourceAttribution {
  sourceType: 'user' | 'url' | 'freeform_ai';
  sourceUrl?: string | null;
}

export interface RecipeIngredientDraft {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

/**
 * An unsaved, unpersisted `RecipeDraft` — mirrors `shared/schema.graphql`'s
 * `RecipeDraft` exactly. Deliberately has no `id`/`householdId` so it can
 * never be mistaken for a stored `Recipe`, matching that type's own doc.
 */
export interface RecipeDraft {
  title: string | null;
  description: string | null;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: CuisineTier1 | null;
  cuisineTier2: string | null;
  dietaryTags: DietaryTag[];
  role: RecipeRole | null;
  ingredients: RecipeIngredientDraft[];
  steps: string[];
  sourceUrl: string | null;
  warnings: string[];
}

/**
 * `RecipeForm`'s own editable field state — every field has a concrete
 * value (never `undefined`) so the form always has something to render,
 * unlike `RecipeInput`/`RecipePatchInput` where absence is meaningful on
 * the wire. `buildRecipePatch` is what translates "unchanged from the
 * loaded recipe" into "absent from the patch" for the edit flow.
 */
export interface RecipeFormValues {
  title: string;
  description: string;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: CuisineTier1 | null;
  cuisineTier2: string;
  dietaryTags: DietaryTag[];
  role: RecipeRole | null;
  ingredients: RecipeIngredientInput[];
  steps: string[];
}
