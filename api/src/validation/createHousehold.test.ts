import { describe, expect, it } from 'vitest';
import { createHouseholdArgsSchema } from './createHousehold.js';

describe('createHouseholdArgsSchema', () => {
  it('accepts a plain non-empty name', () => {
    const result = createHouseholdArgsSchema.safeParse({ name: 'The Sharma Household' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(createHouseholdArgsSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(createHouseholdArgsSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('trims leading/trailing whitespace', () => {
    const result = createHouseholdArgsSchema.safeParse({ name: '  The Sharma Household  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('The Sharma Household');
    }
  });

  it('accepts a name exactly 60 characters long', () => {
    const name = 'a'.repeat(60);
    expect(createHouseholdArgsSchema.safeParse({ name }).success).toBe(true);
  });

  it('rejects a name over 60 characters', () => {
    const name = 'a'.repeat(61);
    expect(createHouseholdArgsSchema.safeParse({ name }).success).toBe(false);
  });

  it('rejects a name absent from the input', () => {
    expect(createHouseholdArgsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a numeric name', () => {
    expect(createHouseholdArgsSchema.safeParse({ name: 12345 }).success).toBe(false);
  });

  it('rejects a name containing a control character (tab)', () => {
    const nameWithTab = 'Bad' + String.fromCharCode(9) + 'Name';
    expect(createHouseholdArgsSchema.safeParse({ name: nameWithTab }).success).toBe(false);
  });

  it('rejects a name containing a control character (newline)', () => {
    const nameWithNewline = 'Bad' + String.fromCharCode(10) + 'Name';
    expect(createHouseholdArgsSchema.safeParse({ name: nameWithNewline }).success).toBe(false);
  });
});
