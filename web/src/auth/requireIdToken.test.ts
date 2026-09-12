import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const { requireIdToken } = await import('./requireIdToken');

beforeEach(() => {
  redirect.mockClear();
});

describe('requireIdToken', () => {
  // RED test 4: an unauthenticated page redirects to sign-in rather than
  // rendering with no data.
  it('redirects to sign-in when there is no session', () => {
    expect(() => requireIdToken(null, '/me')).toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith('/api/auth/signin?callbackUrl=%2Fme');
  });

  it('redirects to sign-in when the session has no idToken (e.g. a failed refresh)', () => {
    expect(() => requireIdToken({ expires: '2099-01-01' }, '/me')).toThrow(/NEXT_REDIRECT/);
  });

  it('returns the idToken when the session has one', () => {
    const idToken = requireIdToken({ expires: '2099-01-01', idToken: 'real-token' }, '/me');

    expect(idToken).toBe('real-token');
    expect(redirect).not.toHaveBeenCalled();
  });
});
