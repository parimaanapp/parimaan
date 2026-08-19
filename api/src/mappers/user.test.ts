import { describe, expect, it } from 'vitest';
import { toGraphQLUser } from './user.js';
import type { UserRow } from '../repositories/userRepository.js';

describe('toGraphQLUser', () => {
  const row: UserRow = {
    id: 'user-1',
    cognitoSub: 'sub-1',
    email: 'user1@example.test',
    displayName: 'User One',
    avatarUrl: 'https://example.test/avatar.png',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('maps snake_case row fields to the camelCase GraphQL User shape', () => {
    expect(toGraphQLUser(row)).toEqual({
      id: 'user-1',
      email: 'user1@example.test',
      displayName: 'User One',
      avatarUrl: 'https://example.test/avatar.png',
    });
  });

  it('maps null displayName/avatarUrl through as null, not undefined', () => {
    const result = toGraphQLUser({ ...row, displayName: null, avatarUrl: null });
    expect(result.displayName).toBeNull();
    expect(result.avatarUrl).toBeNull();
  });
});
