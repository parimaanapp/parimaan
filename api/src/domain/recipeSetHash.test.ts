import { describe, expect, it } from 'vitest';
import { computeRecipeSetHash } from './recipeSetHash.js';

describe('computeRecipeSetHash (D6, E2E_MVP_PLAN.md §23.2.6)', () => {
  it('is a 16-character hex string', () => {
    const hash = computeRecipeSetHash([{ recipeId: 'r1', servingsOverride: null }]);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable regardless of input order (order-independent, per its own doc)', () => {
    const a = computeRecipeSetHash([
      { recipeId: 'r1', servingsOverride: 2 },
      { recipeId: 'r2', servingsOverride: null },
    ]);
    const b = computeRecipeSetHash([
      { recipeId: 'r2', servingsOverride: null },
      { recipeId: 'r1', servingsOverride: 2 },
    ]);
    expect(a).toBe(b);
  });

  it('produces the SAME hash for two calls with the identical planned set (the "same recipe set queried twice" cache-hit precondition)', () => {
    const pairs = [
      { recipeId: 'r1', servingsOverride: 4 },
      { recipeId: 'r2', servingsOverride: null },
    ];
    expect(computeRecipeSetHash(pairs)).toBe(computeRecipeSetHash([...pairs]));
  });

  // D6's own bug fix — the whole reason this hash exists instead of a raw
  // `listId` key: a regenerate that changes even one recipe or one
  // `servingsOverride` MUST produce a different hash, so it never serves a
  // stale cached note for the pre-regenerate plan.
  it('produces a DIFFERENT hash when a servingsOverride changes (the regenerate-changes-the-plan case)', () => {
    const before = computeRecipeSetHash([{ recipeId: 'r1', servingsOverride: 2 }]);
    const after = computeRecipeSetHash([{ recipeId: 'r1', servingsOverride: 4 }]);
    expect(before).not.toBe(after);
  });

  it('produces a DIFFERENT hash when the recipe set itself changes', () => {
    const before = computeRecipeSetHash([{ recipeId: 'r1', servingsOverride: null }]);
    const after = computeRecipeSetHash([
      { recipeId: 'r1', servingsOverride: null },
      { recipeId: 'r2', servingsOverride: null },
    ]);
    expect(before).not.toBe(after);
  });

  it('treats the same recipe twice (e.g. planned on two different days) as different from planning it once', () => {
    const once = computeRecipeSetHash([{ recipeId: 'r1', servingsOverride: null }]);
    const twice = computeRecipeSetHash([
      { recipeId: 'r1', servingsOverride: null },
      { recipeId: 'r1', servingsOverride: null },
    ]);
    expect(once).not.toBe(twice);
  });

  it('produces an empty-set hash for an empty menu, never throwing', () => {
    expect(() => computeRecipeSetHash([])).not.toThrow();
    expect(computeRecipeSetHash([])).toMatch(/^[0-9a-f]{16}$/);
  });
});
