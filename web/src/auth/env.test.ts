import { describe, expect, it } from 'vitest';
import { loadWebAuthConfig } from './env';

describe('loadWebAuthConfig', () => {
  it('derives the Cognito OIDC issuer from the user pool id and region', () => {
    const config = loadWebAuthConfig({
      COGNITO_USER_POOL_ID: 'ap-south-1_example',
      AWS_REGION: 'ap-south-1',
    });

    expect(config).toEqual({
      cognitoUserPoolId: 'ap-south-1_example',
      awsRegion: 'ap-south-1',
      issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_example',
    });
  });

  it('throws a clear error when COGNITO_USER_POOL_ID is missing', () => {
    expect(() => loadWebAuthConfig({ AWS_REGION: 'ap-south-1' })).toThrow(/COGNITO_USER_POOL_ID/);
  });

  it('throws a clear error when AWS_REGION is missing', () => {
    expect(() => loadWebAuthConfig({ COGNITO_USER_POOL_ID: 'ap-south-1_example' })).toThrow(/AWS_REGION/);
  });
});
