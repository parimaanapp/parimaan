import { describe, expect, it } from 'vitest';
import { MAX_FREEFORM_TEXT_LENGTH, parseFreeformRecipeArgsSchema } from './parseFreeformRecipe.js';

describe('parseFreeformRecipeArgsSchema', () => {
  it('accepts well-formed text', () => {
    const result = parseFreeformRecipeArgsSchema.safeParse({ text: 'a recipe for rajma chawal' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(parseFreeformRecipeArgsSchema.safeParse({ text: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(parseFreeformRecipeArgsSchema.safeParse({ text: '   \n\t  ' }).success).toBe(false);
  });

  it('accepts text at exactly the length cap', () => {
    expect(parseFreeformRecipeArgsSchema.safeParse({ text: 'x'.repeat(MAX_FREEFORM_TEXT_LENGTH) }).success).toBe(true);
  });

  it('rejects text one character over the length cap', () => {
    expect(parseFreeformRecipeArgsSchema.safeParse({ text: 'x'.repeat(MAX_FREEFORM_TEXT_LENGTH + 1) }).success).toBe(false);
  });

  it('rejects an explicit null (text is required, not nullable)', () => {
    expect(parseFreeformRecipeArgsSchema.safeParse({ text: null }).success).toBe(false);
  });

  it('rejects a missing text field', () => {
    expect(parseFreeformRecipeArgsSchema.safeParse({}).success).toBe(false);
  });
});
