import { describe, expect, it } from 'vitest';
import { buildAuthorizationHeaders } from './authHeader';

describe('buildAuthorizationHeaders', () => {
  it('sends the raw id token in Authorization, with no Bearer prefix (matches AppSync/mobile convention)', () => {
    expect(buildAuthorizationHeaders('real-id-token')).toEqual({ Authorization: 'real-id-token' });
  });

  it('omits the header entirely when there is no token', () => {
    expect(buildAuthorizationHeaders(undefined)).toEqual({});
  });
});
