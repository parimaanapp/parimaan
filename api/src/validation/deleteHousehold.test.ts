import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deleteHouseholdArgsSchema } from './deleteHousehold.js';

describe('deleteHouseholdArgsSchema', () => {
  it('accepts a well-formed householdId and a non-empty confirmationName', () => {
    const result = deleteHouseholdArgsSchema.safeParse({
      householdId: randomUUID(),
      confirmationName: 'The Sharma House',
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
  ])('rejects a %s householdId', (_label, householdId) => {
    const result = deleteHouseholdArgsSchema.safeParse({ householdId, confirmationName: 'x' });
    expect(result.success).toBe(false);
  });

  it.each([
    ['empty string', ''],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s confirmationName', (_label, confirmationName) => {
    const result = deleteHouseholdArgsSchema.safeParse({
      householdId: randomUUID(),
      confirmationName,
    });
    expect(result.success).toBe(false);
  });

  it('does NOT trim confirmationName — the exact-match check downstream must see what the client actually sent', () => {
    const result = deleteHouseholdArgsSchema.safeParse({
      householdId: randomUUID(),
      confirmationName: '  The Sharma House  ',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.confirmationName).toBe('  The Sharma House  ');
  });
});
