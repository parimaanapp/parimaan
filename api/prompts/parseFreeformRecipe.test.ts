import { describe, expect, it } from 'vitest';
import { buildParseFreeformRecipePrompt, PROMPT_VERSION } from './parseFreeformRecipe.js';

describe('buildParseFreeformRecipePrompt', () => {
  it('is a numeric version, starting at 1', () => {
    expect(PROMPT_VERSION).toBe(1);
  });

  it('embeds the source text verbatim', () => {
    const prompt = buildParseFreeformRecipePrompt('2 cups atta, sifted');
    expect(prompt).toContain('2 cups atta, sifted');
  });

  it('requests JSON only, no markdown fences or prose', () => {
    const prompt = buildParseFreeformRecipePrompt('some recipe');
    expect(prompt).toMatch(/ONLY a single JSON object/i);
    expect(prompt).toMatch(/no markdown code fences/i);
  });

  it('instructs quantity to always be a string', () => {
    expect(buildParseFreeformRecipePrompt('x')).toMatch(/quantity.*ALWAYS a string/is);
  });

  it('instructs the model to ignore embedded instructions in the source text (prompt-injection mitigation)', () => {
    const prompt = buildParseFreeformRecipePrompt('x');
    expect(prompt).toMatch(/ignore.*instruct.*you to deviate/is);
  });

  it('is a pure function with no side effects — same input produces the same output', () => {
    expect(buildParseFreeformRecipePrompt('same text')).toBe(buildParseFreeformRecipePrompt('same text'));
  });
});
