import { z } from 'zod';

const MAX_NAME_LENGTH = 120;
const MAX_UNIT_LENGTH = 20;
const MAX_CATEGORY_LENGTH = 40;
const AWS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// eslint-disable-next-line no-control-regex -- deliberately matching control characters, see addPantryItem.ts's identical helper.
const hasControlCharacters = (value: string): boolean => /[\x00-\x1F\x7F]/.test(value);

/**
 * A partial patch — every field `.optional()`, deliberately NOT
 * `.nullable()`, exactly matching `updateHouseholdSettings`'s own schema
 * doc: an absent field means "leave unchanged"; an explicit `null` is
 * rejected. The `.refine` below rejects a patch with every field absent.
 * Bounds/shape per field mirror `addPantryItem.ts`'s `pantryItemInputSchema`
 * (kept as a separate, not-shared, set of field schemas — this input has no
 * required fields at all, so it isn't `pantryItemInputSchema.partial()`
 * either; duplication here is intentional rather than reused across two
 * meaningfully different shapes).
 */
export const pantryItemPatchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name must not be empty')
      .max(MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`)
      .refine((value) => !hasControlCharacters(value), 'name must not contain control characters')
      .optional(),
    quantity: z.number().min(0, 'quantity must not be negative').optional(),
    unit: z
      .string()
      .trim()
      .min(1, 'unit must not be empty')
      .max(MAX_UNIT_LENGTH, `unit must be at most ${MAX_UNIT_LENGTH} characters`)
      .optional(),
    category: z
      .string()
      .trim()
      .min(1, 'category must not be empty')
      .max(MAX_CATEGORY_LENGTH, `category must be at most ${MAX_CATEGORY_LENGTH} characters`)
      .optional(),
    isStaple: z.boolean().optional(),
    expiryDate: z
      .string()
      .regex(AWS_DATE_PATTERN, 'expiryDate must be an AWSDate (YYYY-MM-DD) string')
      .optional(),
    lowThreshold: z.number().min(0, 'lowThreshold must not be negative').optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Input must contain at least one field to update.',
  });

export type PantryItemPatchInput = z.infer<typeof pantryItemPatchSchema>;

export const updatePantryItemArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  input: pantryItemPatchSchema,
});

export type UpdatePantryItemArgs = z.infer<typeof updatePantryItemArgsSchema>;
