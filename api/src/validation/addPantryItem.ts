import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

const MAX_NAME_LENGTH = 120;
const MAX_UNIT_LENGTH = 20;
const MAX_CATEGORY_LENGTH = 40;
/** `YYYY-MM-DD` — AppSync's own `AWSDate` wire format. */
const AWS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Same reasoning as `validation/createHousehold.ts`'s identical helper: a pantry item name is displayed as-is, so control characters have no legitimate reason to appear. */
const hasControlCharacters = (value: string): boolean =>
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, see comment above.
  /[\x00-\x1F\x7F]/.test(value);

const nameSchema = z
  .string()
  .trim()
  .min(1, 'name must not be empty')
  .max(MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`)
  .refine((value) => !hasControlCharacters(value), 'name must not contain control characters');

/**
 * `quantity`/`lowThreshold` are AppSync `Float` arguments — `z.number()`
 * alone already rejects `NaN` and non-finite values (Zod's number check is
 * `Number.isFinite`, not just `typeof === 'number'`), so no separate
 * `.finite()` call is needed to cover that case; `.min(0)` covers the
 * negative-quantity rejection.
 */
const quantitySchema = z.number().min(0, 'quantity must not be negative');

const unitSchema = z
  .string()
  .trim()
  .min(1, 'unit must not be empty')
  .max(MAX_UNIT_LENGTH, `unit must be at most ${MAX_UNIT_LENGTH} characters`);

const categorySchema = z
  .string()
  .trim()
  .min(1, 'category must not be empty')
  .max(MAX_CATEGORY_LENGTH, `category must be at most ${MAX_CATEGORY_LENGTH} characters`);

const expiryDateSchema = z.string().regex(AWS_DATE_PATTERN, 'expiryDate must be an AWSDate (YYYY-MM-DD) string');

const lowThresholdSchema = z.number().min(0, 'lowThreshold must not be negative');

/**
 * Validates `PantryItemInput`. Deliberately has no `addedBy` field to
 * validate — the SDL itself doesn't accept one (`shared/schema.graphql`'s
 * own doc on `PantryItemInput`), and the resolver takes it exclusively from
 * the verified caller identity.
 */
export const pantryItemInputSchema = z.object({
  name: nameSchema,
  quantity: quantitySchema,
  unit: unitSchema,
  category: categorySchema.optional(),
  isStaple: z.boolean().optional(),
  expiryDate: expiryDateSchema.optional(),
  lowThreshold: lowThresholdSchema.optional(),
});

export type PantryItemInput = z.infer<typeof pantryItemInputSchema>;

export const addPantryItemArgsSchema = z.object({
  householdId: householdIdSchema,
  input: pantryItemInputSchema,
});

export type AddPantryItemArgs = z.infer<typeof addPantryItemArgsSchema>;
