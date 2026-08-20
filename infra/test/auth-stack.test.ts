import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { AuthStack } from '../stacks/auth-stack';

const FAKE_GOOGLE_CLIENT_ID = 'fake-google-client-id-123.apps.googleusercontent.com';

describe('AuthStack', () => {
  const build = (envName: 'dev' | 'prod'): AuthStack => {
    const app = new cdk.App();
    return new AuthStack(app, `Parimaan-${envName}-Auth`, {
      envName,
      googleClientId: FAKE_GOOGLE_CLIENT_ID,
    });
  };

  const synth = (envName: 'dev' | 'prod'): Template => Template.fromStack(build(envName));

  it('synthesizes without error for dev', () => {
    expect(() => synth('dev')).not.toThrow();
  });

  it('synthesizes without error for prod', () => {
    expect(() => synth('prod')).not.toThrow();
  });

  it('creates a user pool with self sign-up disabled and email sign-in alias (Google-only, no password path)', () => {
    const template = synth('dev');
    // Cognito's CFN semantics are inverted from what the property name suggests:
    // `AllowAdminCreateUserOnly: true` is what `selfSignUpEnabled: false` produces —
    // it means "only admin/federated flows can create users," i.e. self-service
    // signup is disabled. Verified against actual synth output, not assumed.
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({
        AllowAdminCreateUserOnly: true,
      }),
      AliasAttributes: Match.absent(),
      UsernameAttributes: ['email'],
    });
  });

  it('declares exactly one user pool', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
  });

  it('configures email as a required, mutable standard attribute and fullname/picture as optional, mutable', () => {
    // Cognito Schema is immutable post-creation (CFN can only replace, not
    // update, the pool) — matching SYSTEM_DESIGN.md §7.4's full attribute
    // list (email, name, picture) now is cheap; adding `picture` later once
    // real users exist would mean a destructive pool replacement.
    const template = synth('dev');
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Schema: Match.arrayWith([
        Match.objectLike({ Name: 'email', Required: true, Mutable: true }),
        Match.objectLike({ Name: 'name', Required: false, Mutable: true }),
        Match.objectLike({ Name: 'picture', Required: false, Mutable: true }),
      ]),
    });
  });

  it('creates a Google identity provider with profile/email/openid scopes', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderType: 'Google',
      ProviderDetails: Match.objectLike({
        client_id: FAKE_GOOGLE_CLIENT_ID,
        authorize_scopes: 'profile email openid',
      }),
    });
  });

  it('declares exactly one Google identity provider', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
  });

  it('maps Google email/name/picture to the matching Cognito attributes', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      AttributeMapping: Match.objectLike({
        email: 'email',
        name: 'name',
        picture: 'picture',
      }),
    });
  });

  it('sources the Google client secret from Secrets Manager via a dynamic reference — never a literal', () => {
    const json = JSON.stringify(synth('dev').toJSON());
    expect(json).toContain(
      '{{resolve:secretsmanager:parimaan/google-oauth-secret:SecretString:::}}',
    );
  });

  it('includes the plain-text Google client ID literal (safe — client IDs are public) but no secret-like literal value', () => {
    const json = JSON.stringify(synth('dev').toJSON());
    expect(json).toContain(FAKE_GOOGLE_CLIENT_ID);
    // A client *secret* literal would not be sourced via dynamic reference —
    // guard that the only Secrets-Manager-shaped value present is the dynamic
    // reference itself, not some other inlined secret string.
    const secretsManagerLiteralCount = (
      json.match(/parimaan\/google-oauth-secret/g) ?? []
    ).length;
    expect(secretsManagerLiteralCount).toBeGreaterThan(0);
    expect(json).not.toMatch(/client_secret["']?\s*:\s*["'](?!\{\{resolve:)[^"']+["']/);
  });

  it('declares exactly 2 user pool clients', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 2);
  });

  it('restricts both app clients to Google only — CDK defaults to also allowing native COGNITO auth unless explicitly excluded', () => {
    // Verified empirically: omitting `supportedIdentityProviders` on addClient()
    // makes CDK default to every IdP on the pool PLUS the literal "COGNITO",
    // which would let any user with a Cognito password bypass Google OAuth
    // entirely. This is the real security gap this test guards against.
    const template = synth('dev');
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    for (const resource of Object.values(clients)) {
      const providers = (resource as { Properties?: { SupportedIdentityProviders?: string[] } })
        .Properties?.SupportedIdentityProviders;
      expect(providers).toEqual(['Google']);
    }
  });

  it('disables native username/password auth flows on both app clients (SRP, user-password, admin-user-password, custom)', () => {
    // Verified empirically: passing `authFlows` with every flag explicitly
    // `false` (not an empty object, not omitted) is what actually produces
    // ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"] with no interactive
    // auth path — omitting authFlows entirely lets AWS default to allowing
    // SRP, which would let a Cognito-password-bearing user bypass Google.
    const template = synth('dev');
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    for (const resource of Object.values(clients)) {
      const flows = (resource as { Properties?: { ExplicitAuthFlows?: string[] } }).Properties
        ?.ExplicitAuthFlows;
      expect(flows).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
    }
  });

  it('has one public client with no generated secret (mobile) and one confidential client with a generated secret (web)', () => {
    const template = synth('dev');
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const generateSecretFlags = Object.values(clients).map(
      (resource) => (resource as { Properties?: { GenerateSecret?: boolean } }).Properties
        ?.GenerateSecret,
    );
    expect(generateSecretFlags).toHaveLength(2);
    expect(generateSecretFlags).toContain(false);
    expect(generateSecretFlags).toContain(true);
  });

  it('configures the mobile client with the exact parimaan:// callback and logout URLs', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      CallbackURLs: ['parimaan://auth'],
      LogoutURLs: ['parimaan://logout'],
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: Match.arrayWith(['email', 'openid', 'profile']),
    });
  });

  it('configures the mobile client token validities (1h access, 30d refresh)', () => {
    const template = synth('dev');
    // CDK's default CFN unit for both AccessTokenValidity and RefreshTokenValidity
    // is minutes, regardless of the Duration granularity passed in — verified
    // against actual synth output. 1h = 60 min, 30d = 43200 min.
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AccessTokenValidity: 60,
      RefreshTokenValidity: 43200,
    });
  });

  it('configures the web client callback/logout URLs for the dev domain', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: true,
      CallbackURLs: ['https://dev.parimaan.app/api/auth/callback/cognito'],
      LogoutURLs: ['https://dev.parimaan.app'],
    });
  });

  it('configures the web client callback/logout URLs for the prod domain', () => {
    const template = synth('prod');
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: true,
      CallbackURLs: ['https://parimaan.app/api/auth/callback/cognito'],
      LogoutURLs: ['https://parimaan.app'],
    });
  });

  it('the web client callback URL differs between dev and prod synths (domain-dependent)', () => {
    const devClients = synth('dev').findResources('AWS::Cognito::UserPoolClient', {
      Properties: { GenerateSecret: true },
    });
    const prodClients = synth('prod').findResources('AWS::Cognito::UserPoolClient', {
      Properties: { GenerateSecret: true },
    });
    const devCallback = Object.values(devClients)[0] as {
      Properties: { CallbackURLs: string[] };
    };
    const prodCallback = Object.values(prodClients)[0] as {
      Properties: { CallbackURLs: string[] };
    };
    expect(devCallback.Properties.CallbackURLs).not.toEqual(prodCallback.Properties.CallbackURLs);
  });

  it('declares both app clients with an explicit DependsOn referencing the Google identity provider', () => {
    const template = synth('dev');
    const json = template.toJSON() as {
      Resources: Record<string, { Type: string; DependsOn?: string | string[] }>;
    };

    const idpLogicalIds = Object.entries(json.Resources)
      .filter(([, resource]) => resource.Type === 'AWS::Cognito::UserPoolIdentityProvider')
      .map(([logicalId]) => logicalId);
    expect(idpLogicalIds).toHaveLength(1);
    const [idpLogicalId] = idpLogicalIds;

    const clientResources = Object.values(json.Resources).filter(
      (resource) => resource.Type === 'AWS::Cognito::UserPoolClient',
    );
    expect(clientResources).toHaveLength(2);

    for (const client of clientResources) {
      const dependsOn = client.DependsOn
        ? Array.isArray(client.DependsOn)
          ? client.DependsOn
          : [client.DependsOn]
        : [];
      expect(dependsOn).toContain(idpLogicalId);
    }
  });

  it('creates a Cognito-hosted domain with prefix exactly "parimaan-dev" for dev', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'parimaan-dev',
    });
  });

  it('creates a Cognito-hosted domain with prefix exactly "parimaan-prod" for prod', () => {
    const template = synth('prod');
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'parimaan-prod',
    });
  });

  it('does not embed an account id or region literal in the synthesized template', () => {
    // See the identical comment in data-stack.test.ts: a bare `/\d{12}/`
    // can false-positive on a random 12-digit run inside a bundled
    // Lambda's long content-hash S3 asset key. Requiring the digits to be
    // quote-bounded catches a real embedded account id without that risk.
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/"\d{12}"/);
    expect(json).not.toMatch(/ap-south-1/);
  });

  it('exposes userPool, mobileClient, and webClient as public readonly properties for downstream stacks', () => {
    const stack = build('dev');
    expect(stack.userPool).toBeDefined();
    expect(stack.userPool).toBeInstanceOf(UserPool);
    expect(stack.mobileClient).toBeDefined();
    expect(stack.mobileClient).toBeInstanceOf(UserPoolClient);
    expect(stack.webClient).toBeDefined();
    expect(stack.webClient).toBeInstanceOf(UserPoolClient);
  });

  // ---------------------------------------------------------------------
  // CfnOutputs — the mobile app's build-time config (see docs/RUNBOOK.md).
  // Every value below is public by design: the mobile app client is a public
  // PKCE client (`generateSecret: false`, asserted above), so its client id,
  // the pool id, and the hosted-UI domain all ship inside the mobile binary
  // regardless. Exporting them is a convenience, not a disclosure.
  // ---------------------------------------------------------------------

  it('exports the user pool id as a CfnOutput named UserPoolId, env-scoped', () => {
    synth('dev').hasOutput('UserPoolId', {
      Value: Match.anyValue(),
      Export: { Name: 'Parimaan-dev-UserPoolId' },
    });
  });

  it('exports the MOBILE app client id as a CfnOutput named MobileClientId — a Ref to the public (secretless) client, never the web client', () => {
    const template = synth('dev');
    const mobileClientLogicalIds = Object.keys(
      template.findResources('AWS::Cognito::UserPoolClient', {
        Properties: { GenerateSecret: false },
      }),
    );
    expect(mobileClientLogicalIds).toHaveLength(1);
    template.hasOutput('MobileClientId', {
      Value: { Ref: mobileClientLogicalIds[0] },
      Export: { Name: 'Parimaan-dev-MobileClientId' },
    });
  });

  it('does not export the confidential web client id — only the public mobile client is mobile-facing config', () => {
    const template = synth('dev');
    const webClientLogicalIds = Object.keys(
      template.findResources('AWS::Cognito::UserPoolClient', {
        Properties: { GenerateSecret: true },
      }),
    );
    expect(webClientLogicalIds).toHaveLength(1);
    const outputsJson = JSON.stringify((template.toJSON() as { Outputs?: unknown }).Outputs ?? {});
    expect(outputsJson).not.toContain(webClientLogicalIds[0] as string);
  });

  it('exports the Cognito hosted-UI base URL as a CfnOutput named CognitoDomain', () => {
    synth('dev').hasOutput('CognitoDomain', {
      Value: Match.anyValue(),
      Export: { Name: 'Parimaan-dev-CognitoDomain' },
    });
  });

  it('exports the deploy region as a CfnOutput named Region, resolved from the AWS::Region pseudo-parameter — never a hardcoded literal', () => {
    synth('dev').hasOutput('Region', {
      Value: { Ref: 'AWS::Region' },
      Export: { Name: 'Parimaan-dev-Region' },
    });
  });

  it('env-scopes every export name so dev and prod can coexist in one account/region', () => {
    // CloudFormation export names are unique per account+region — an
    // unprefixed `UserPoolId` would make the second env's deploy fail.
    const prodOutputs = (synth('prod').toJSON() as {
      Outputs: Record<string, { Export?: { Name?: string } }>;
    }).Outputs;
    const exportNames = Object.values(prodOutputs).map((output) => output.Export?.Name);
    expect(exportNames).toContain('Parimaan-prod-UserPoolId');
    expect(exportNames).toContain('Parimaan-prod-MobileClientId');
    expect(exportNames).toContain('Parimaan-prod-CognitoDomain');
    expect(exportNames).toContain('Parimaan-prod-Region');
  });

  it('exports no secret-bearing value — the Google client secret dynamic reference never appears in Outputs', () => {
    const outputsJson = JSON.stringify(
      (synth('dev').toJSON() as { Outputs?: unknown }).Outputs ?? {},
    );
    expect(outputsJson).not.toContain('secretsmanager');
  });

  // Exact-match, not just "doesn't contain a known-bad substring" — the same
  // strong form ApiStack's own "exports nothing but the GraphQL URL" test
  // uses. A substring check only catches a specific already-anticipated leak
  // shape; this fails CI the moment ANY new output is added to this stack,
  // sensitive or not, forcing a review rather than trusting the diff to be
  // caught by eye.
  it('exports nothing but the four documented mobile-config values', () => {
    const outputs = (synth('dev').toJSON() as { Outputs?: Record<string, unknown> }).Outputs ?? {};
    expect(Object.keys(outputs).sort()).toEqual([
      'CognitoDomain',
      'MobileClientId',
      'Region',
      'UserPoolId',
    ]);
  });

  // Change-detector per DEV_WORKFLOW.md §3.4(c): fine-grained assertions above
  // are primary; this snapshot exists only to flag *any* unreviewed diff in
  // the synthesized template, not to encode intent on its own.
  it('matches the known-good synthesized template snapshot (dev)', () => {
    expect(synth('dev').toJSON()).toMatchSnapshot();
  });
});
