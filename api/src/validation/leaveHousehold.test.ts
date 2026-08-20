import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { leaveHouseholdArgsSchema } from './leaveHousehold.js';

describe('leaveHouseholdArgsSchema', () => {
  it('accepts a well-formed householdId', () => {
    const result = leaveHouseholdArgsSchema.safeParse({ householdId: randomUUID() });
    expect(result.success).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId', (_label, householdId) => {
    const result = leaveHouseholdArgsSchema.safeParse({ householdId });
    expect(result.success).toBe(false);
  });

  it('ignores any client-supplied userId — the departing member is always the caller', () => {
    const result = leaveHouseholdArgsSchema.safeParse({
      householdId: randomUUID(),
      userId: randomUUID(),
    });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data)).toEqual(['householdId']);
  });
});
