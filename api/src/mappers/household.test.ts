import { describe, expect, it } from 'vitest';
import { toGraphQLHousehold, toGraphQLMembership, toGraphQLSettings } from './household.js';
import type { HouseholdRow, MembershipWithHouseholdRow, SettingsRow } from '../repositories/householdRepository.js';
import type { GraphQLUser } from './user.js';

const settingsRow: SettingsRow = {
  householdId: 'household-1',
  mealsEnabled: ['breakfast', 'lunch', 'dinner'],
  mealStructure: { lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 } },
  cuisineTier1: ['north_indian'],
  cuisineTier2Weights: {},
  dietaryTags: [],
  allergens: [],
  skipIngredients: [],
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

const householdRow: HouseholdRow = {
  id: 'household-1',
  name: 'The Test House',
  inviteCode: 'ABC234',
  primaryUserId: 'user-1',
  subscriptionStatus: 'past_due',
  planId: null,
  stripeCustomerId: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
};

const user: GraphQLUser = {
  id: 'user-1',
  email: 'user1@example.test',
  displayName: 'User One',
  avatarUrl: null,
};

describe('toGraphQLSettings', () => {
  it('serializes AWSJSON fields (mealStructure, cuisineTier2Weights) as JSON strings', () => {
    const result = toGraphQLSettings(settingsRow);
    expect(typeof result.mealStructure).toBe('string');
    expect(JSON.parse(result.mealStructure)).toEqual(settingsRow.mealStructure);
    expect(typeof result.cuisineTier2Weights).toBe('string');
    expect(JSON.parse(result.cuisineTier2Weights)).toEqual(settingsRow.cuisineTier2Weights);
  });

  it('maps snake_case-derived fields to camelCase', () => {
    const result = toGraphQLSettings(settingsRow);
    expect(result).toMatchObject({
      householdId: 'household-1',
      mealsEnabled: ['breakfast', 'lunch', 'dinner'],
      cuisineTier1: ['north_indian'],
      dietaryTags: [],
      allergens: [],
      skipIngredients: [],
    });
  });
});

describe('toGraphQLHousehold', () => {
  it('round-trips subscriptionStatus exactly, without reformatting (e.g. past_due stays past_due)', () => {
    const result = toGraphQLHousehold(householdRow, [], settingsRow);
    expect(result.subscriptionStatus).toBe('past_due');
  });

  it('maps snake_case fields to camelCase', () => {
    const result = toGraphQLHousehold(householdRow, [], settingsRow);
    expect(result).toMatchObject({
      id: 'household-1',
      name: 'The Test House',
      inviteCode: 'ABC234',
      primaryUserId: 'user-1',
    });
  });

  it('embeds the given members and settings', () => {
    const membershipRow: MembershipWithHouseholdRow = {
      id: 'membership-1',
      householdId: 'household-1',
      userId: 'user-1',
      role: 'primary',
      joinedAt: new Date('2024-01-01T00:00:00.000Z'),
      household: householdRow,
      settings: settingsRow,
    };
    const member = toGraphQLMembership(membershipRow, user);
    const result = toGraphQLHousehold(householdRow, [member], settingsRow);
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({ id: 'membership-1', role: 'primary' });
    expect(result.settings.householdId).toBe('household-1');
  });
});

describe('toGraphQLMembership', () => {
  it('formats joinedAt as a valid ISO-8601 timestamp', () => {
    const membership: MembershipWithHouseholdRow = {
      id: 'membership-1',
      householdId: 'household-1',
      userId: 'user-1',
      role: 'member',
      joinedAt: new Date('2024-06-15T10:30:00.000Z'),
      household: householdRow,
      settings: settingsRow,
    };
    const result = toGraphQLMembership(membership, user);
    expect(result.joinedAt).toBe('2024-06-15T10:30:00.000Z');
    expect(() => new Date(result.joinedAt).toISOString()).not.toThrow();
  });

  it('keeps enum-shaped role values unreformatted', () => {
    const membership: MembershipWithHouseholdRow = {
      id: 'membership-1',
      householdId: 'household-1',
      userId: 'user-1',
      role: 'primary',
      joinedAt: new Date(),
      household: householdRow,
      settings: settingsRow,
    };
    expect(toGraphQLMembership(membership, user).role).toBe('primary');
  });

  it('embeds the given user as the user field', () => {
    const membership: MembershipWithHouseholdRow = {
      id: 'membership-1',
      householdId: 'household-1',
      userId: 'user-1',
      role: 'primary',
      joinedAt: new Date(),
      household: householdRow,
      settings: settingsRow,
    };
    expect(toGraphQLMembership(membership, user).user).toEqual(user);
  });
});
