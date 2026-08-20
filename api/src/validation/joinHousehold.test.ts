import { describe, expect, it } from 'vitest';
import { joinHouseholdArgsSchema } from './joinHousehold.js';

describe('joinHouseholdArgsSchema', () => {
  it('accepts a well-formed 6-character invite code', () => {
    const result = joinHouseholdArgsSchema.safeParse({ inviteCode: 'ABC234' });
    expect(result.success).toBe(true);
  });

  it('trims whitespace and uppercases before validating', () => {
    const result = joinHouseholdArgsSchema.safeParse({ inviteCode: '  abc234  ' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.inviteCode).toBe('ABC234');
  });

  it.each([
    ['empty string', ''],
    ['too short', 'ABC23'],
    ['too long', 'ABC2345'],
    ['absent', undefined],
    ['numeric', 123456],
  ])('rejects a %s inviteCode', (_label, inviteCode) => {
    const result = joinHouseholdArgsSchema.safeParse({ inviteCode });
    expect(result.success).toBe(false);
  });
});
