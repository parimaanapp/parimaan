import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { householdIdSchema } from './householdId.js';

describe('householdIdSchema', () => {
  it('accepts a well-formed UUID', () => {
    const result = householdIdSchema.safeParse(randomUUID());
    expect(result.success).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
    ['uuid with trailing whitespace', `${randomUUID()} `],
  ])('rejects a %s householdId', (_label, value) => {
    const result = householdIdSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it('reports the shared message every household-scoped resolver returns', () => {
    const result = householdIdSchema.safeParse('nope');
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toBe(
      'householdId must be a valid UUID',
    );
  });
});
