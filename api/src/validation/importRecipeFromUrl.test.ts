import { describe, expect, it } from 'vitest';
import { importRecipeFromUrlArgsSchema, MAX_URL_LENGTH } from './importRecipeFromUrl.js';

describe('importRecipeFromUrlArgsSchema', () => {
  it('accepts a well-formed https URL string (structural only — SSRF validation is net/safeUrl.ts\'s own job)', () => {
    expect(importRecipeFromUrlArgsSchema.safeParse({ url: 'https://example.com/recipe' }).success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(importRecipeFromUrlArgsSchema.safeParse({ url: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(importRecipeFromUrlArgsSchema.safeParse({ url: '   ' }).success).toBe(false);
  });

  const PREFIX = 'https://example.com/';

  it('accepts a URL at exactly the length cap', () => {
    const url = `${PREFIX}${'a'.repeat(MAX_URL_LENGTH - PREFIX.length)}`;
    expect(url.length).toBe(MAX_URL_LENGTH);
    expect(importRecipeFromUrlArgsSchema.safeParse({ url }).success).toBe(true);
  });

  it('rejects a URL one character over the length cap', () => {
    const url = `${PREFIX}${'a'.repeat(MAX_URL_LENGTH - PREFIX.length + 1)}`;
    expect(url.length).toBe(MAX_URL_LENGTH + 1);
    expect(importRecipeFromUrlArgsSchema.safeParse({ url }).success).toBe(false);
  });

  it('rejects an explicit null (url is required, not nullable)', () => {
    expect(importRecipeFromUrlArgsSchema.safeParse({ url: null }).success).toBe(false);
  });

  it('rejects a missing url field', () => {
    expect(importRecipeFromUrlArgsSchema.safeParse({}).success).toBe(false);
  });
});
