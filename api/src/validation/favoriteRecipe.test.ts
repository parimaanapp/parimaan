import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { favoriteRecipeArgsSchema } from './favoriteRecipe.js';

describe('favoriteRecipeArgsSchema', () => {
  it('accepts a valid id and favorite', () => {
    expect(favoriteRecipeArgsSchema.safeParse({ id: randomUUID(), favorite: true }).success).toBe(true);
    expect(favoriteRecipeArgsSchema.safeParse({ id: randomUUID(), favorite: false }).success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(
      favoriteRecipeArgsSchema.safeParse({ id: 'not-a-uuid', favorite: true }).success,
    ).toBe(false);
  });

  it('rejects a missing favorite', () => {
    expect(favoriteRecipeArgsSchema.safeParse({ id: randomUUID() }).success).toBe(false);
  });

  it('rejects a non-boolean favorite', () => {
    expect(
      favoriteRecipeArgsSchema.safeParse({ id: randomUUID(), favorite: 'yes' }).success,
    ).toBe(false);
  });
});
