import { describe, expect, it } from 'vitest';
import type { AppSyncIdentityCognito, AppSyncIdentityIAM } from 'aws-lambda';
import { extractCallerIdentity } from './identity.js';
import { UnauthorizedError } from '../errors.js';

const buildCognitoIdentity = (
  overrides: Partial<AppSyncIdentityCognito> = {},
  claimOverrides: Record<string, unknown> = {},
): AppSyncIdentityCognito => ({
  sub: 'fake-user-sub',
  issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
  username: 'fake-user',
  claims: {
    sub: 'fake-user-sub',
    email: 'fake@example.test',
    email_verified: true,
    'cognito:username': 'fake-user',
    ...claimOverrides,
  },
  sourceIp: ['127.0.0.1'],
  defaultAuthStrategy: 'ALLOW',
  groups: null,
  ...overrides,
});

const buildIamIdentity = (): AppSyncIdentityIAM => ({
  accountId: '123456789012',
  cognitoIdentityPoolId: '',
  cognitoIdentityId: '',
  sourceIp: ['127.0.0.1'],
  username: 'iam-user',
  userArn: 'arn:aws:iam::123456789012:role/some-role',
  cognitoIdentityAuthType: '',
  cognitoIdentityAuthProvider: '',
});

describe('extractCallerIdentity', () => {
  it('throws UnauthorizedError for a null identity', () => {
    expect(() => extractCallerIdentity(null)).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError for an undefined identity', () => {
    expect(() => extractCallerIdentity(undefined)).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError for a non-Cognito (IAM) identity shape', () => {
    expect(() => extractCallerIdentity(buildIamIdentity())).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when identity.sub is missing', () => {
    const identity = buildCognitoIdentity({ sub: undefined as unknown as string });
    expect(() => extractCallerIdentity(identity)).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when claims.email is missing', () => {
    const identity = buildCognitoIdentity({}, { email: undefined });
    expect(() => extractCallerIdentity(identity)).toThrow(UnauthorizedError);
  });

  it('maps the happy path correctly, including optional claims', () => {
    const identity = buildCognitoIdentity(
      {},
      { name: 'Fake User', picture: 'https://example.test/avatar.png' },
    );
    const result = extractCallerIdentity(identity);
    expect(result).toEqual({
      cognitoSub: 'fake-user-sub',
      email: 'fake@example.test',
      displayName: 'Fake User',
      avatarUrl: 'https://example.test/avatar.png',
    });
  });

  it('maps absent optional claims to null, not undefined or empty string', () => {
    const identity = buildCognitoIdentity();
    const result = extractCallerIdentity(identity);
    expect(result.displayName).toBeNull();
    expect(result.avatarUrl).toBeNull();
  });
});
