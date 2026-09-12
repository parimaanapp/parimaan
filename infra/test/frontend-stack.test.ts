import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../stacks/auth-stack';
import { FrontendStack } from '../stacks/frontend-stack';

const FAKE_GOOGLE_CLIENT_ID = 'fake-google-client-id-123.apps.googleusercontent.com';
const FAKE_GRAPHQL_URL = 'https://fake123.appsync-api.us-east-1.amazonaws.com/graphql';

/**
 * Real `AuthStack`, built in its own `cdk.App` root, so `FrontendStack`'s
 * `userPool`/`webClient`/`webClientCredentialsSecret` props exercise the
 * same cross-stack reference shape production wiring
 * (`infra/bin/parimaan.ts`) uses — the identical "reuse the real upstream
 * stack as the test fixture" pattern `api-stack.test.ts`'s own
 * `buildFakeDataStack` doc comment describes, applied here to `AuthStack`.
 */
const buildRealAuthStack = (app: cdk.App, envName: 'dev' | 'prod'): AuthStack =>
  new AuthStack(app, `Parimaan-${envName}-Auth`, {
    envName,
    googleClientId: FAKE_GOOGLE_CLIENT_ID,
  });

describe('FrontendStack', () => {
  const build = (envName: 'dev' | 'prod'): FrontendStack => {
    const app = new cdk.App();
    const auth = buildRealAuthStack(app, envName);
    return new FrontendStack(app, `Parimaan-${envName}-Frontend`, {
      envName,
      userPool: auth.userPool,
      webClient: auth.webClient,
      webClientCredentialsSecret: auth.webClientCredentialsSecret,
      graphqlUrl: FAKE_GRAPHQL_URL,
    });
  };

  const synth = (envName: 'dev' | 'prod'): Template => Template.fromStack(build(envName));

  it('synthesizes without error for dev', () => {
    expect(() => synth('dev')).not.toThrow();
  });

  it('synthesizes without error for prod', () => {
    expect(() => synth('prod')).not.toThrow();
  });

  it('declares exactly one Amplify App', () => {
    synth('dev').resourceCountIs('AWS::Amplify::App', 1);
  });

  it('configures the App for SSR (WEB_COMPUTE), not the static-only WEB default — a Next.js server-rendered app silently breaks otherwise', () => {
    synth('dev').hasResourceProperties('AWS::Amplify::App', {
      Platform: 'WEB_COMPUTE',
    });
  });

  it('declares exactly one branch, named "dev" for the dev environment and "main" for prod', () => {
    const devTemplate = synth('dev');
    devTemplate.resourceCountIs('AWS::Amplify::Branch', 1);
    devTemplate.hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'dev' });

    const prodTemplate = synth('prod');
    prodTemplate.resourceCountIs('AWS::Amplify::Branch', 1);
    prodTemplate.hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'main' });
  });

  it('declares exactly one custom domain association, mapped to the environment-appropriate domain reused verbatim from auth-stack.ts (dev.parimaan.app / parimaan.app)', () => {
    const devTemplate = synth('dev');
    devTemplate.resourceCountIs('AWS::Amplify::Domain', 1);
    devTemplate.hasResourceProperties('AWS::Amplify::Domain', { DomainName: 'dev.parimaan.app' });

    const prodTemplate = synth('prod');
    prodTemplate.resourceCountIs('AWS::Amplify::Domain', 1);
    prodTemplate.hasResourceProperties('AWS::Amplify::Domain', { DomainName: 'parimaan.app' });
  });

  it('maps the branch to the domain root', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Amplify::Domain', {
      SubDomainSettings: Match.arrayWith([
        Match.objectLike({ Prefix: '' }),
      ]),
    });
  });

  it('includes the non-secret env vars the Next.js app needs — AppSync endpoint, user pool id, web client id', () => {
    const template = synth('dev');
    const json = template.toJSON() as {
      Resources: Record<string, { Type: string; Properties?: { EnvironmentVariables?: { Name: string; Value: unknown }[] } }>;
    };
    const appResource = Object.values(json.Resources).find((r) => r.Type === 'AWS::Amplify::App');
    expect(appResource).toBeDefined();
    const envVarNames = (appResource?.Properties?.EnvironmentVariables ?? []).map((v) => v.Name);
    expect(envVarNames).toContain('NEXT_PUBLIC_APPSYNC_GRAPHQL_URL');
    expect(envVarNames).toContain('COGNITO_USER_POOL_ID');
    expect(envVarNames).toContain('COGNITO_WEB_CLIENT_ID');
  });

  it('passes the AppSync URL through verbatim (the real cross-stack value, not re-derived)', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::Amplify::App', {
      EnvironmentVariables: Match.arrayWith([
        Match.objectLike({ Name: 'NEXT_PUBLIC_APPSYNC_GRAPHQL_URL', Value: FAKE_GRAPHQL_URL }),
      ]),
    });
  });

  it('never includes the web client secret value as an env var — only its ARN, under a name that is obviously "fetch me at runtime", never the literal secret', () => {
    const template = synth('dev');
    const json = template.toJSON() as {
      Resources: Record<string, { Type: string; Properties?: { EnvironmentVariables?: { Name: string; Value: unknown }[] } }>;
    };
    const appResource = Object.values(json.Resources).find((r) => r.Type === 'AWS::Amplify::App');
    const envVars = appResource?.Properties?.EnvironmentVariables ?? [];

    // The ARN env var must exist...
    const secretArnVar = envVars.find((v) => v.Name === 'WEB_CLIENT_CREDENTIALS_SECRET_ARN');
    expect(secretArnVar).toBeDefined();
    // ...and its value must be a dynamic reference (an ARN token resolved at
    // deploy time), never a plain string — an ARN happens to be non-secret,
    // but asserting it's still a dynamic CFN intrinsic rather than a literal
    // guards against a future change swapping the ARN for the secret VALUE
    // and that value getting hardcoded in the same careless way.
    expect(typeof secretArnVar?.Value).not.toBe('string');

    // No env var anywhere carries a value containing the word "secret" in
    // a way that looks like a *value* (as opposed to the ARN variable's own
    // name, which is fine) — and no env var's value is a plain string that
    // could be a literal secret (the only plain-string env var values this
    // stack declares are the AppSync URL and nothing else).
    const plainStringValues = envVars
      .filter((v) => v.Name !== 'NEXT_PUBLIC_APPSYNC_GRAPHQL_URL')
      .map((v) => v.Value)
      .filter((v): v is string => typeof v === 'string');
    expect(plainStringValues).toEqual([]);
  });

  it('grants the Amplify compute role read access to the web client credentials secret (so NextAuth can fetch it at cold start)', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });

  it('exports exactly the app id and default domain — nothing secret-bearing', () => {
    const outputs = (synth('dev').toJSON() as { Outputs?: Record<string, unknown> }).Outputs ?? {};
    const exportNames = Object.values(outputs).map(
      (o) => (o as { Export?: { Name?: string } }).Export?.Name,
    );
    expect(exportNames).toContain('Parimaan-dev-FrontendAppId');
    expect(exportNames).toContain('Parimaan-dev-FrontendDefaultDomain');

    const outputsJson = JSON.stringify(outputs);
    expect(outputsJson).not.toContain('WebClientCredentialsSecret');
    expect(outputsJson).not.toContain('secretsmanager');
  });
});
