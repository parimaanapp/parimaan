import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { recipesArgsSchema } from './recipes.js';

describe('recipesArgsSchema', () => {
  it('accepts just a householdId (no filters)', () => {
    expect(recipesArgsSchema.safeParse({ householdId: randomUUID() }).success).toBe(true);
  });

  it('accepts a householdId with role and isFavorite', () => {
    expect(
      recipesArgsSchema.safeParse({ householdId: randomUUID(), role: 'sabzi_dal', isFavorite: true })
        .success,
    ).toBe(true);
  });

  it('rejects a non-UUID householdId', () => {
    expect(recipesArgsSchema.safeParse({ householdId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a missing householdId', () => {
    expect(recipesArgsSchema.safeParse({}).success).toBe(false);
  });

  // Regression: the exact W5 §11.5.5 bug shape — a real AppSync/Ferry
  // client sends an unset nullable argument as an explicit `null`, not an
  // absent key. `.optional()` would reject this in production while every
  // test using `undefined` stayed green.
  it('treats an explicit null role/isFavorite the same as an absent one', () => {
    const result = recipesArgsSchema.safeParse({
      householdId: randomUUID(),
      role: null,
      isFavorite: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBeNull();
      expect(result.data.isFavorite).toBeNull();
    }
  });

  it('rejects an unrecognised role — closed enum, not passed through', () => {
    expect(
      recipesArgsSchema.safeParse({ householdId: randomUUID(), role: 'dessert' }).success,
    ).toBe(false);
  });

  it('normalises role case/whitespace before matching, not rejecting a differently-cased known value', () => {
    const result = recipesArgsSchema.safeParse({ householdId: randomUUID(), role: '  Sabzi_Dal  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('sabzi_dal');
    }
  });

  it.each(['breakfast', 'carb', 'sabzi_dal', 'accompaniment', 'snack', 'sweet', 'drink'])(
    'accepts the known role %s',
    (role) => {
      expect(recipesArgsSchema.safeParse({ householdId: randomUUID(), role }).success).toBe(true);
    },
  );

  it('rejects an over-long role string without matching it (defense-in-depth cap)', () => {
    expect(
      recipesArgsSchema.safeParse({ householdId: randomUUID(), role: 'a'.repeat(65) }).success,
    ).toBe(false);
  });

  it('rejects a non-boolean isFavorite', () => {
    expect(
      recipesArgsSchema.safeParse({ householdId: randomUUID(), isFavorite: 'yes' }).success,
    ).toBe(false);
  });
});
