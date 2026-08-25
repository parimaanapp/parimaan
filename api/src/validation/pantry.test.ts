import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pantryArgsSchema } from './pantry.js';

describe('pantryArgsSchema', () => {
  it('accepts just a householdId (no filters)', () => {
    expect(pantryArgsSchema.safeParse({ householdId: randomUUID() }).success).toBe(true);
  });

  it('accepts a householdId with search and category', () => {
    expect(
      pantryArgsSchema.safeParse({ householdId: randomUUID(), search: 'dal', category: 'grain' })
        .success,
    ).toBe(true);
  });

  it('rejects a non-UUID householdId', () => {
    expect(pantryArgsSchema.safeParse({ householdId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a missing householdId', () => {
    expect(pantryArgsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a search string over 100 characters', () => {
    expect(
      pantryArgsSchema.safeParse({ householdId: randomUUID(), search: 'a'.repeat(101) }).success,
    ).toBe(false);
  });

  it('rejects a category string over 40 characters', () => {
    expect(
      pantryArgsSchema.safeParse({ householdId: randomUUID(), category: 'a'.repeat(41) }).success,
    ).toBe(false);
  });

  it('trims search and category', () => {
    const result = pantryArgsSchema.safeParse({
      householdId: randomUUID(),
      search: '  dal  ',
      category: '  grain  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe('dal');
      expect(result.data.category).toBe('grain');
    }
  });
});
