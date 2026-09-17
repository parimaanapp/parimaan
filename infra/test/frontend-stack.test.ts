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
  /**
   * `context` defaults to none — `enableCustomDomain` is off by default
   * (a real gap found live: Amplify refuses any `Domain` update while its
   * certificate sits in `PENDING_VERIFICATION`, so this stack does not
   * provision one until a human completes the one-time DNS verification
   * step and opts back in via `-c enableCustomDomain=true`).
   */
  const build = (envName: 'dev' | 'prod', context: Record<string, string> = {}): FrontendStack => {
    const app = new cdk.App({ context });
    const auth = buildRealAuthStack(app, envName);
    return new FrontendStack(app, `Parimaan-${envName}-Frontend`, {
      envName,
      userPool: auth.userPool,
      webClient: auth.webClient,
      webClientCredentialsSecret: auth.webClientCredentialsSecret,
      graphqlUrl: FAKE_GRAPHQL_URL,
    });
  };

  const synth = (envName: 'dev' | 'prod', context?: Record<string, string>): Template =>
    Template.fromStack(build(envName, context));

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

  it('configures a build spec that enables corepack (pnpm) and treats web/ as a monorepo appRoot — a real build failed live without either', () => {
    // Regression guard for finding #4: Amplify's build image has no pnpm
    // pre-installed, and this repo's Next.js app lives in the `web/`
    // workspace of a pnpm-workspace monorepo, not at the repo root. A real
    // build against the deployed app failed with "pnpm: command not
    // found" before this fix.
    const json = synth('dev').toJSON() as {
      Resources: Record<string, { Type: string; Properties?: { BuildSpec?: string } }>;
    };
    const appResource = Object.values(json.Resources).find((r) => r.Type === 'AWS::Amplify::App');
    const buildSpecYaml = appResource?.Properties?.BuildSpec ?? '';
    expect(buildSpecYaml).toContain('corepack enable');
    expect(buildSpecYaml).toContain('appRoot: web');
    expect(buildSpecYaml).toMatch(/pnpm install/);
    expect(buildSpecYaml).toMatch(/pnpm --filter @parimaan\/web build/);
  });

  it('sets the identical build spec on the Branch itself, not only the App — a real build ran the auto-detected default and failed until this was added', () => {
    // Regression guard for finding #5: `App.buildSpec` alone did nothing
    // for an actual build — confirmed live via `aws amplify get-branch`
    // showing `buildSpec: None` even after `aws amplify get-app` showed it
    // correctly set. Amplify's build service resolves the effective spec
    // from the Branch, not inherited from the App.
    const json = synth('dev').toJSON() as {
      Resources: Record<string, { Type: string; Properties?: { BuildSpec?: string } }>;
    };
    const branchResource = Object.values(json.Resources).find((r) => r.Type === 'AWS::Amplify::Branch');
    const buildSpecYaml = branchResource?.Properties?.BuildSpec ?? '';
    expect(buildSpecYaml).toContain('corepack enable');
    expect(buildSpecYaml).toContain('appRoot: web');
  });

  it('declares exactly one branch, tracking the real git "main" branch for both dev and prod', () => {
    // This repo has exactly one git branch, `main` — every other stack
    // already deploys from it regardless of AWS environment. A real bug
    // (branchName: 'dev' for the dev env) was found live once the GitHub
    // connection actually existed to surface it: Amplify's own `git clone`
    // fails outright against a branch that was never created
    // (`fatal: Remote branch dev not found in upstream origin`). This test
    // is the regression guard for that fix.
    const devTemplate = synth('dev');
    devTemplate.resourceCountIs('AWS::Amplify::Branch', 1);
    devTemplate.hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'main' });

    const prodTemplate = synth('prod');
    prodTemplate.resourceCountIs('AWS::Amplify::Branch', 1);
    prodTemplate.hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'main' });
  });

  it('declares no custom domain association by default — enableCustomDomain is off until DNS verification is done', () => {
    // A real gap found live: Amplify refuses any update to a `Domain`
    // resource while its certificate sits in `PENDING_VERIFICATION`
    // (the DNS CNAME record for cert validation was never added at
    // wherever dev.parimaan.app is actually hosted), and CloudFormation
    // bundles Domain into the same changeset as Branch — so an
    // otherwise-unrelated branch-name fix failed and rolled back with it,
    // live. Default-off avoids that until a human completes the one-time
    // DNS step.
    const devTemplate = synth('dev');
    devTemplate.resourceCountIs('AWS::Amplify::Domain', 0);

    const prodTemplate = synth('prod');
    prodTemplate.resourceCountIs('AWS::Amplify::Domain', 0);
  });

  it('declares the custom domain association, mapped to the environment-appropriate domain reused verbatim from auth-stack.ts (dev.parimaan.app / parimaan.app), once opted in via enableCustomDomain=true', () => {
    const devTemplate = synth('dev', { enableCustomDomain: 'true' });
    devTemplate.resourceCountIs('AWS::Amplify::Domain', 1);
    devTemplate.hasResourceProperties('AWS::Amplify::Domain', { DomainName: 'dev.parimaan.app' });

    const prodTemplate = synth('prod', { enableCustomDomain: 'true' });
    prodTemplate.resourceCountIs('AWS::Amplify::Domain', 1);
    prodTemplate.hasResourceProperties('AWS::Amplify::Domain', { DomainName: 'parimaan.app' });
  });

  it('maps the branch to the domain root, once opted in via enableCustomDomain=true', () => {
    const template = synth('dev', { enableCustomDomain: 'true' });
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
