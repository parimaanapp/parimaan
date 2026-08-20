import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { householdArgsSchema } from './household.js';

describe('householdArgsSchema', () => {
  it('accepts a well-formed householdId', () => {
    const result = householdArgsSchema.safeParse({ householdId: randomUUID() });
    expect(result.success).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId', (_label, householdId) => {
    const result = householdArgsSchema.safeParse({ householdId });
    expect(result.success).toBe(false);
  });

  it('ignores extra client-supplied fields — only householdId survives', () => {
    const result = householdArgsSchema.safeParse({
      householdId: randomUUID(),
      inviteCode: 'HACKED',
    });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data)).toEqual(['householdId']);
  });
});
