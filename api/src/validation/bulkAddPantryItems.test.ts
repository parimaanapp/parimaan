import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MAX_BULK_PANTRY_ITEMS, bulkAddPantryItemsArgsSchema } from './bulkAddPantryItems.js';

const validItem = { name: 'Toor Dal', quantity: 1, unit: 'kg' };

describe('bulkAddPantryItemsArgsSchema', () => {
  it('accepts a single item', () => {
    expect(
      bulkAddPantryItemsArgsSchema.safeParse({ householdId: randomUUID(), items: [validItem] })
        .success,
    ).toBe(true);
  });

  it('accepts exactly the max number of items', () => {
    const items = Array.from({ length: MAX_BULK_PANTRY_ITEMS }, () => validItem);
    expect(bulkAddPantryItemsArgsSchema.safeParse({ householdId: randomUUID(), items }).success).toBe(
      true,
    );
  });

  it('rejects over the max number of items', () => {
    const items = Array.from({ length: MAX_BULK_PANTRY_ITEMS + 1 }, () => validItem);
    expect(bulkAddPantryItemsArgsSchema.safeParse({ householdId: randomUUID(), items }).success).toBe(
      false,
    );
  });

  it('rejects an empty items array', () => {
    expect(
      bulkAddPantryItemsArgsSchema.safeParse({ householdId: randomUUID(), items: [] }).success,
    ).toBe(false);
  });

  it('rejects a non-UUID householdId', () => {
    expect(
      bulkAddPantryItemsArgsSchema.safeParse({ householdId: 'not-a-uuid', items: [validItem] })
        .success,
    ).toBe(false);
  });

  it('rejects if any single item in the batch is invalid', () => {
    expect(
      bulkAddPantryItemsArgsSchema.safeParse({
        householdId: randomUUID(),
        items: [validItem, { ...validItem, quantity: -1 }],
      }).success,
    ).toBe(false);
  });
});
