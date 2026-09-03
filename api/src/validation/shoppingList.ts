import { z } from 'zod';

const menuIdSchema = z.string().uuid('menuId must be a valid UUID');

/** `Mutation.generateShoppingList`'s only argument — mirrors `validation/menu.ts`'s `autoFillPreviewArgsSchema` shape (a single required `menuId`). */
export const generateShoppingListArgsSchema = z.object({
  menuId: menuIdSchema,
});

export type GenerateShoppingListArgs = z.infer<typeof generateShoppingListArgsSchema>;

/**
 * `Mutation.regenerateShoppingList`'s arguments (D8, E2E_MVP_PLAN.md
 * §17.2.8) — `confirmed` is required (`Boolean!` on the wire), not
 * `.nullish()`: it is a genuine two-valued instruction with no "leave
 * unchanged" reading, the same reasoning `autoFillWeekArgsSchema.overwrite`
 * already applies to its own required boolean.
 */
export const regenerateShoppingListArgsSchema = z.object({
  menuId: menuIdSchema,
  confirmed: z.boolean(),
});

export type RegenerateShoppingListArgs = z.infer<typeof regenerateShoppingListArgsSchema>;
