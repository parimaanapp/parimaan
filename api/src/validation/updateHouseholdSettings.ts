import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
import { CUISINE_TIER1_VALUES } from '../domain/cuisineTiers.js';
import { DIETARY_TAG_VALUES } from '../domain/dietaryTags.js';

// Mirrors `shared/schema.graphql`'s enum value names exactly — these are
// TEXT-backed values persisted verbatim (see `householdRepository.ts`'s own
// comment on this), so drift here is a silent data-shape break, not just a
// validation-message annoyance. `CUISINE_TIER1_VALUES`/`DIETARY_TAG_VALUES`
// come from `domain/cuisineTiers.ts`/`dietaryTags.ts` — shared with
// `validation/recipes.ts` so the two consumers of these same closed enums
// can't drift out of sync (E2E_MVP_PLAN.md §12.2.6; the bug that prompted
// pulling these out, `1787811731724_fix-recipes-cuisine-tier1-check.ts`).
const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
const CUISINE_TIER2_WEIGHT_VALUES = ['more', 'normal', 'less'] as const;

const MAX_CUISINE_TIER2_KEYS = 20;
const MAX_CUISINE_TIER2_KEY_LENGTH = 40;
/**
 * Bounds the raw AWSJSON string *before* `JSON.parse` runs — the field-level
 * checks below (key counts, key lengths, enum values) only apply after
 * parsing succeeds, so an oversized string would otherwise be handed to
 * `JSON.parse` unbounded. In practice AppSync's own request-payload limit
 * already caps this, but that's a platform default this code doesn't itself
 * assert — this makes the bound explicit rather than implicit. 8KB is
 * generously larger than any legitimate `mealStructure`/`cuisineTier2Weights`
 * payload (bounded to a handful of short keys either way).
 */
const MAX_AWS_JSON_INPUT_LENGTH = 8_192;

const mealTypeSchema = z.enum(MEAL_TYPES);
const cuisineTier1Schema = z.enum(CUISINE_TIER1_VALUES);
const dietaryTagSchema = z.enum(DIETARY_TAG_VALUES);

/**
 * Tolerantly "parses" an `AWSJSON` input value: AppSync's real wire protocol
 * always sends this scalar as a JSON *string*, but this codebase has never
 * exercised an AWSJSON *input* before (only output, via `toGraphQLSettings`)
 * — so this defensively also accepts an already-parsed plain value (object,
 * array, ...), in case a test or a future direct invocation supplies one
 * pre-parsed. A malformed JSON string is turned into a Zod issue via
 * `z.ZodError`-compatible throwing inside `z.preprocess`, not a raw parse
 * exception.
 */
const parseAwsJsonInput = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length > MAX_AWS_JSON_INPUT_LENGTH) {
    // Same "return the invalid value, let the shape schema reject it"
    // convention as the JSON.parse failure path below — an oversized string
    // fails `z.record(...)` downstream (it's still a string, not a record)
    // with a normal Zod issue, without ever reaching `JSON.parse`.
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    // Returning the invalid original value (rather than throwing here) lets
    // the downstream shape schema reject it with a normal Zod issue instead
    // of an uncaught SyntaxError escaping `safeParse`.
    return value;
  }
};

const mealStructureEntrySchema = z.object({
  carb: z.number().int().min(0).max(10),
  sabzi_dal: z.number().int().min(0).max(10),
  accompaniment: z.number().int().min(0).max(10),
});

const mealStructureSchema = z.preprocess(
  parseAwsJsonInput,
  z
    .record(z.string(), mealStructureEntrySchema)
    .refine((obj) => Object.keys(obj).every((key) => (MEAL_TYPES as readonly string[]).includes(key)), {
      message: 'mealStructure keys must be valid meal types.',
    }),
);

const cuisineTier2WeightsSchema = z.preprocess(
  parseAwsJsonInput,
  z
    .record(z.string(), z.enum(CUISINE_TIER2_WEIGHT_VALUES))
    .refine((obj) => Object.keys(obj).length <= MAX_CUISINE_TIER2_KEYS, {
      message: `cuisineTier2Weights must have at most ${MAX_CUISINE_TIER2_KEYS} keys`,
    })
    .refine((obj) => Object.keys(obj).every((key) => key.length <= MAX_CUISINE_TIER2_KEY_LENGTH), {
      message: `cuisineTier2Weights keys must be at most ${MAX_CUISINE_TIER2_KEY_LENGTH} characters`,
    }),
);

/**
 * A partial patch — every field `.optional()`, deliberately NOT `.nullable()`.
 * An absent field means "leave unchanged"; an explicit `null` is rejected as
 * a `ValidationError` (Zod naturally rejects `null` against a non-nullable
 * inner schema) because "clear this field" isn't a supported operation yet.
 * The `.refine` below additionally rejects a patch with every field absent —
 * there is nothing for `updateHouseholdSettings` to do with that.
 */
export const householdSettingsInputSchema = z
  .object({
    mealsEnabled: z.array(mealTypeSchema).optional(),
    mealStructure: mealStructureSchema.optional(),
    cuisineTier1: z.array(cuisineTier1Schema).optional(),
    cuisineTier2Weights: cuisineTier2WeightsSchema.optional(),
    dietaryTags: z.array(dietaryTagSchema).optional(),
    allergens: z.array(z.string()).optional(),
    skipIngredients: z.array(z.string()).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Input must contain at least one field to update.',
  });

export type HouseholdSettingsInput = z.infer<typeof householdSettingsInputSchema>;

export const updateHouseholdSettingsArgsSchema = z.object({
  householdId: householdIdSchema,
  input: householdSettingsInputSchema,
});

export type UpdateHouseholdSettingsArgs = z.infer<typeof updateHouseholdSettingsArgsSchema>;
