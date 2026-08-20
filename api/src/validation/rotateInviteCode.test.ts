import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rotateInviteCodeArgsSchema } from './rotateInviteCode.js';

describe('rotateInviteCodeArgsSchema', () => {
  it('accepts a well-formed householdId', () => {
    const result = rotateInviteCodeArgsSchema.safeParse({ householdId: randomUUID() });
    expect(result.success).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['not a uuid', 'not-a-uuid'],
    ['absent', undefined],
    ['numeric', 12345],
  ])('rejects a %s householdId', (_label, householdId) => {
    const result = rotateInviteCodeArgsSchema.safeParse({ householdId });
    expect(result.success).toBe(false);
  });

  it('ignores any client-supplied inviteCode — the replacement code is minted server-side only', () => {
    const result = rotateInviteCodeArgsSchema.safeParse({
      householdId: randomUUID(),
      inviteCode: 'HACKED',
    });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data)).toEqual(['householdId']);
  });
});
