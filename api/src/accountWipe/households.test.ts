import { describe, expect, it } from 'vitest';
import { classifyHouseholds } from './households.js';
import type { HouseholdWithMembers } from './types.js';

const member = (userId: string, role: 'primary' | 'member', joinedAt: string) => ({
  membershipId: `m-${userId}`,
  userId,
  role,
  joinedAt,
});

describe('classifyHouseholds', () => {
  it('deletes a household when every member is in the wipe set', () => {
    const households: HouseholdWithMembers[] = [
      {
        id: 'h1',
        name: 'A',
        primaryUserId: 'u1',
        members: [member('u1', 'primary', '2026-01-01'), member('u2', 'member', '2026-01-02')],
      },
    ];
    const result = classifyHouseholds(households, new Set(['u1', 'u2']));
    expect(result.deleted).toEqual([{ id: 'h1', name: 'A' }]);
    expect(result.kept).toEqual([]);
    expect(result.promotions).toEqual([]);
  });

  it('deletes a household with zero members', () => {
    const result = classifyHouseholds(
      [{ id: 'h1', name: 'A', primaryUserId: 'u1', members: [] }],
      new Set(['u1']),
    );
    expect(result.deleted).toHaveLength(1);
  });

  it('counts a non-wiped, non-null primary as remaining: keeps instead of deleting', () => {
    const result = classifyHouseholds(
      [{ id: 'h1', name: 'A', primaryUserId: 'u9', members: [member('u1', 'member', '2026-01-01')] }],
      new Set(['u1']),
    );
    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([
      { id: 'h1', name: 'A', remainingMemberCount: 1, wipedMemberCount: 1 },
    ]);
    expect(result.promotions).toEqual([]);
  });

  it('keeps a memberless household whose primary is not being wiped', () => {
    const result = classifyHouseholds(
      [{ id: 'h1', name: 'A', primaryUserId: 'u9', members: [] }],
      new Set(['u1']),
    );
    expect(result.deleted).toEqual([]);
  });

  it('does not double count a non-wiped primary that also has a membership row', () => {
    const result = classifyHouseholds(
      [
        {
          id: 'h1',
          name: 'A',
          primaryUserId: 'u9',
          members: [member('u9', 'primary', '2026-01-01'), member('u1', 'member', '2026-01-02')],
        },
      ],
      new Set(['u1']),
    );
    expect(result.kept[0]?.remainingMemberCount).toBe(1);
  });

  it('keeps a household shared with a non-wipe user and reports counts', () => {
    const households: HouseholdWithMembers[] = [
      {
        id: 'h1',
        name: 'A',
        primaryUserId: 'u3',
        members: [member('u3', 'primary', '2026-01-01'), member('u1', 'member', '2026-01-02')],
      },
    ];
    const result = classifyHouseholds(households, new Set(['u1']));
    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([
      { id: 'h1', name: 'A', remainingMemberCount: 1, wipedMemberCount: 1 },
    ]);
    expect(result.promotions).toEqual([]);
  });

  it('promotes the earliest-joined remaining member when the primary is wiped', () => {
    const households: HouseholdWithMembers[] = [
      {
        id: 'h1',
        name: 'A',
        primaryUserId: 'u1',
        members: [
          member('u1', 'primary', '2026-01-01'),
          member('u4', 'member', '2026-03-01'),
          member('u3', 'member', '2026-02-01'),
        ],
      },
    ];
    const result = classifyHouseholds(households, new Set(['u1']));
    expect(result.promotions).toEqual([
      { householdId: 'h1', membershipId: 'm-u3', newPrimaryUserId: 'u3' },
    ]);
  });

  it('ignores households with no wipe-set involvement', () => {
    const households: HouseholdWithMembers[] = [
      { id: 'h1', name: 'A', primaryUserId: 'u3', members: [member('u3', 'primary', '2026-01-01')] },
    ];
    expect(classifyHouseholds(households, new Set(['u1']))).toEqual({
      deleted: [],
      kept: [],
      promotions: [],
    });
  });

  it('is deterministic regardless of input order', () => {
    const a: HouseholdWithMembers = {
      id: 'h2',
      name: 'B',
      primaryUserId: 'u1',
      members: [member('u1', 'primary', '1')],
    };
    const b: HouseholdWithMembers = {
      id: 'h1',
      name: 'A',
      primaryUserId: 'u1',
      members: [member('u1', 'primary', '1')],
    };
    const r = classifyHouseholds([a, b], new Set(['u1']));
    expect(r.deleted.map((h) => h.id)).toEqual(['h1', 'h2']);
  });
});
