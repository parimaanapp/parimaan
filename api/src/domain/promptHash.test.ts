import { describe, expect, it } from 'vitest';
import { computePromptHash } from './promptHash.js';

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
