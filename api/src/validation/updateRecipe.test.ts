import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deleteRecipeArgsSchema, recipePatchInputSchema, updateRecipeArgsSchema } from './updateRecipe.js';

describe('recipePatchInputSchema', () => {
  it('accepts a patch with a single scalar field', () => {
    expect(recipePatchInputSchema.safeParse({ title: 'New Title' }).success).toBe(true);
  });

  it('rejects a patch with every field absent', () => {
    expect(recipePatchInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an explicit null for a scalar field — clearing is not supported', () => {
    expect(recipePatchInputSchema.safeParse({ title: null }).success).toBe(false);
    expect(recipePatchInputSchema.safeParse({ description: null }).success).toBe(false);
    expect(recipePatchInputSchema.safeParse({ cuisineTier1: null }).success).toBe(false);
  });

  it('rejects an unrecognised role, cuisineTier1, or dietaryTag', () => {
    expect(recipePatchInputSchema.safeParse({ role: 'dessert' }).success).toBe(false);
    expect(recipePatchInputSchema.safeParse({ cuisineTier1: 'italian' }).success).toBe(false);
    expect(recipePatchInputSchema.safeParse({ dietaryTags: ['carnivore'] }).success).toBe(false);
  });

  it('normalises role case/whitespace before matching', () => {
    const result = recipePatchInputSchema.safeParse({ role: '  Breakfast  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('breakfast');
    }
  });

  // The core §12.2.4 semantic: present (even []) is a real value distinct
  // from absent — both must parse successfully, and the resolver (not this
  // schema) is what distinguishes them via `!== undefined`.
  it('accepts an explicit empty ingredients array, distinct from an absent key', () => {
    const withEmpty = recipePatchInputSchema.safeParse({ ingredients: [] });
    expect(withEmpty.success).toBe(true);
    if (withEmpty.success) {
      expect(withEmpty.data.ingredients).toEqual([]);
    }

    const withoutKey = recipePatchInputSchema.safeParse({ title: 'X' });
    expect(withoutKey.success).toBe(true);
    if (withoutKey.success) {
      expect(withoutKey.data.ingredients).toBeUndefined();
    }
  });

  it('accepts an explicit empty steps array, distinct from an absent key', () => {
    const result = recipePatchInputSchema.safeParse({ steps: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
    }
  });

  it('rejects more than 100 ingredients', () => {
    const ingredients = Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}` }));
    expect(recipePatchInputSchema.safeParse({ ingredients }).success).toBe(false);
  });

  it('rejects a blank title', () => {
    expect(recipePatchInputSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects a negative servings', () => {
    expect(recipePatchInputSchema.safeParse({ servings: 0 }).success).toBe(false);
  });

  it('accepts a patch that only touches ingredients', () => {
    expect(
      recipePatchInputSchema.safeParse({ ingredients: [{ name: 'Onion' }] }).success,
    ).toBe(true);
  });
});

describe('updateRecipeArgsSchema', () => {
  it('accepts a valid id and patch', () => {
    expect(
      updateRecipeArgsSchema.safeParse({ id: randomUUID(), input: { title: 'X' } }).success,
    ).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(
      updateRecipeArgsSchema.safeParse({ id: 'not-a-uuid', input: { title: 'X' } }).success,
    ).toBe(false);
  });
});

describe('deleteRecipeArgsSchema', () => {
  it('accepts a valid UUID id', () => {
    expect(deleteRecipeArgsSchema.safeParse({ id: randomUUID() }).success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(deleteRecipeArgsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });
});
