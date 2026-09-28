import { describe, expect, it } from 'vitest';
import { computePromptHash, computeSuggestionId } from './promptHash.js';

const base = { model: 'gemini-x', temperature: 0.6, maxOutputTokens: 3500, prompt: 'hello' };

describe('computePromptHash (D5)', () => {
  it('is 16 lowercase hex characters', () => {
    expect(computePromptHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for identical inputs', () => {
    expect(computePromptHash(base)).toBe(computePromptHash({ ...base }));
  });

  it.each([
    ['the prompt', { prompt: 'hello!' }],
    ['the model', { model: 'gemini-y' }],
    ['the temperature', { temperature: 0.3 }],
    ['the output-token limit', { maxOutputTokens: 4096 }],
  ])('changes when %s changes — anything that changes the answer changes the key', (_label, change) => {
    expect(computePromptHash({ ...base, ...change })).not.toBe(computePromptHash(base));
  });

  it('cannot be confused by a value that borrows text from its neighbour', () => {
    const a = computePromptHash({ model: 'a', temperature: 1, maxOutputTokens: 2, prompt: '3|x' });
    const b = computePromptHash({ model: 'a', temperature: 1, maxOutputTokens: 23, prompt: '|x' });
    expect(a).not.toBe(b);
  });
});

describe('computeSuggestionId (S4\'s key for UI state: expanded card, saved marker, the detail route)', () => {
  it('is stable for the same prompt hash and title, so it survives a cache hit', () => {
    expect(computeSuggestionId('aaaaaaaaaaaaaaaa', 'Aloo Jeera')).toBe(computeSuggestionId('aaaaaaaaaaaaaaaa', 'Aloo Jeera'));
  });

  it('differs by title and by prompt hash, and is 16 lowercase hex characters', () => {
    const id = computeSuggestionId('aaaaaaaaaaaaaaaa', 'Aloo Jeera');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(computeSuggestionId('aaaaaaaaaaaaaaaa', 'Dal Tadka')).not.toBe(id);
    expect(computeSuggestionId('bbbbbbbbbbbbbbbb', 'Aloo Jeera')).not.toBe(id);
  });
});
