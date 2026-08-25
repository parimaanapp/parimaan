import { describe, expect, it } from 'vitest';
import { toGraphQLPantryItem } from './pantryItem.js';
import type { PantryItemRow } from '../repositories/pantryRepository.js';

const baseRow: PantryItemRow = {
  id: 'item-1',
  householdId: 'household-1',
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
  category: 'dal',
  isStaple: true,
  expiryDate: '2027-03-01',
  lowThreshold: 0.5,
  addedBy: 'user-1',
  addedAt: new Date('2026-08-25T10:00:00.000Z'),
  updatedAt: new Date('2026-08-25T11:00:00.000Z'),
};

describe('toGraphQLPantryItem', () => {
  it('maps every field through', () => {
    const result = toGraphQLPantryItem(baseRow);
    expect(result).toEqual({
      id: 'item-1',
      householdId: 'household-1',
      name: 'Toor Dal',
      quantity: 2,
      unit: 'kg',
      category: 'dal',
      isStaple: true,
      expiryDate: '2027-03-01',
      lowThreshold: 0.5,
      addedBy: 'user-1',
      addedAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T11:00:00.000Z',
    });
  });

  it('passes a null category, expiryDate, and lowThreshold through as null', () => {
    const result = toGraphQLPantryItem({
      ...baseRow,
      category: null,
      expiryDate: null,
      lowThreshold: null,
    });
    expect(result.category).toBeNull();
    expect(result.expiryDate).toBeNull();
    expect(result.lowThreshold).toBeNull();
  });
});
