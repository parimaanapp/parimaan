import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from 'aws-cdk-lib';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
  /**
   * User pool from AuthStack — FrontendStack does not create its own.
   * Only its id is consumed (a non-secret runtime env var for NextAuth);
   * typed as the concrete `UserPool` class (matching `AuthStack.userPool`'s
   * type), same `exactOptionalPropertyTypes` friction `ApiStackProps`'s own
   * `userPool`/`vpc` props already document and work around.
   */
  readonly userPool: UserPool;
  /**
   * Confidential web app client from AuthStack (W18 D1 — already built,
   * never re-created here). Only its id is read directly (non-secret); its
   * generated secret is consumed exclusively via `webClientCredentialsSecret`
   * below, never as a literal.
   */
  readonly webClient: UserPoolClient;
  /**
   * The Secrets Manager secret `AuthStack` writes the web client's id/secret
   * into (W18 S1, D1). `FrontendStack` never reads its *value* — it only
   * grants the Amplify app's compute role `secretsmanager:GetSecretValue`
   * on this ARN and passes the ARN (never the secret) as a runtime env var,
   * mirroring `api-stack.ts`'s own `GEMINI_API_KEY_SECRET_ARN` pattern for
   * `parimaan/gemini-api-key`.
   */
  readonly webClientCredentialsSecret: Secret;
  /**
   * AppSync GraphQL endpoint URL from ApiStack (already a `CfnOutput`,
   * `Parimaan-{env}-GraphQlUrl` — not sensitive, per that stack's own doc
   * comment: every request is Cognito-authorized regardless of who knows
   * the URL). Passed directly rather than re-reading the `CfnOutput`, the
   * same "take the real cross-stack prop, not a re-derived value" pattern
   * `ApiStack` itself uses for `vpc`/`dbCluster`/etc.
   */
  readonly graphqlUrl: string;
}

/**
 * Amplify Hosting for the Next.js web dashboard (W18 S1, D6).
 *
 * This is the first Amplify Hosting resource and the first new top-level
 * CDK stack since W1/W3/W4's network/data/auth/api stacks. Per
 * E2E_MVP_PLAN.md §24.2.6's own explicit instruction, the `@aws-cdk/aws-
 * amplify-alpha` construct's real API shape was re-verified against this
 * repo's actual pinned `aws-cdk-lib@2.208.0` — by reading the alpha
 * package's own shipped `.d.ts` files (`npm pack
 * @aws-cdk/aws-amplify-alpha@2.208.0-alpha.0`) and by a real `cdk synth`,
 * not by trusting documentation that may describe a different version.
 * Findings, each confirmed rather than assumed:
 *
 * 1. **Source-control connection.** The construct offers exactly three
 *    `ISourceCodeProvider` implementations at this version: GitHub, GitLab,
 *    and CodeCommit — each taking a personal-access-token-shaped
 *    `SecretValue` (`oauthToken`), NOT a GitHub App connection. There is no
 *    "connect via GitHub App" option in this construct version; Amplify
 *    Hosting's GitHub App integration is a console/API-only flow this L2
 *    construct does not model. **This is the one genuine manual-setup gap
 *    this slice cannot automate away**: a human must create a GitHub PAT
 *    (repo scope) out-of-band, store it as a Secrets Manager secret (same
 *    convention as `parimaan/google-oauth-secret`), and pass its ARN via
 *    CDK context — see `githubTokenSecretName` below. Until that exists,
 *    `sourceCodeProvider` is omitted and the `App`/`Branch`/`Domain` deploy
 *    with no connected repository (a real, valid intermediate state —
 *    Amplify supports manual/API-triggered deploys without a linked repo).
 * 2. **SSR compute setting.** `AppProps.platform` defaults to
 *    `Platform.WEB` (static-only). A server-rendered Next.js app needs
 *    `Platform.WEB_COMPUTE` explicitly — confirmed directly against
 *    `app.d.ts`'s own doc comment ("WEB_COMPUTE — ... for server side
 *    rendered (SSR) apps (i.e. NextJS)"). Leaving this at the default would
 *    silently deploy the dashboard as a static export, breaking every
 *    server component/Route Handler S3 onward depends on.
 * 3. **Custom domain shape.** A domain association is its own construct
 *    (`Domain`, added via `app.addDomain(id, options)`), not an inline prop
 *    on `App` or `Branch`. Branches are mapped onto it afterward via
 *    `domain.mapRoot(branch)` (root domain) / `domain.mapSubDomain(branch,
 *    prefix)` (subdomains) — confirmed via `domain.d.ts`.
 *
 * See SYSTEM_DESIGN.md §9.2 and E2E_MVP_PLAN.md §24.2.6 for the full design
 * rationale.
 */
export class FrontendStack extends cdk.Stack {
  public readonly app: amplify.App;
  public readonly branch: amplify.Branch;
  public readonly domain: amplify.Domain;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { envName, userPool, webClient, webClientCredentialsSecret, graphqlUrl } = props;
    // Reused verbatim from `auth-stack.ts`'s own `webDomain` computation
    // (W18 D6's own explicit instruction: do not re-derive a second,
    // possibly-diverging domain-naming rule). `auth-stack.ts` does not
    // export this as a stack output/prop today, so it is recomputed here
    // using the identical literal rule — if that rule ever changes, both
    // call sites must change together (flagged in the doc comment on
    // `auth-stack.ts`'s own inline `webDomain` for a future cross-check).
    const webDomain = envName === 'prod' ? 'parimaan.app' : 'dev.parimaan.app';
    const branchName = envName === 'prod' ? 'main' : 'dev';

    // Optional: a GitHub PAT for the source-control connection (finding #1
    // above). Absent in normal dev iteration until a human completes the
    // one-time manual PAT-creation step documented there; the app still
    // deploys without it, just with no linked repository.
    const githubTokenSecretName = this.node.tryGetContext('githubTokenSecretName') as
      | string
      | undefined;
    const githubOwner = this.node.tryGetContext('githubOwner') as string | undefined;
    const githubRepo = this.node.tryGetContext('githubRepo') as string | undefined;
    const sourceCodeProvider =
      githubTokenSecretName && githubOwner && githubRepo
        ? new amplify.GitHubSourceCodeProvider({
            owner: githubOwner,
            repository: githubRepo,
            oauthToken: cdk.SecretValue.secretsManager(githubTokenSecretName),
          })
        : undefined;

    this.app = new amplify.App(this, 'App', {
      appName: `parimaan-${envName}-web`,
      // Finding #2 above — SSR Next.js needs WEB_COMPUTE, not the WEB
      // (static-only) default.
      platform: amplify.Platform.WEB_COMPUTE,
      ...(sourceCodeProvider ? { sourceCodeProvider } : {}),
      environmentVariables: {
        // All three are already-public values other stacks already export
        // via CfnOutput (ApiStack's GraphQlUrl; AuthStack's UserPoolId; the
        // web client id is non-secret by the same "client ids are meant to
        // be public" reasoning `AuthStackProps.googleClientId`'s own doc
        // comment already states — only the generated client *secret* is
        // sensitive). The secret itself is deliberately NOT an environment
        // variable here — see `WEB_CLIENT_CREDENTIALS_SECRET_ARN` below,
        // fetched at NextAuth cold start instead, identical to
        // `GEMINI_API_KEY_SECRET_ARN`'s pattern in api-stack.ts.
        NEXT_PUBLIC_APPSYNC_GRAPHQL_URL: graphqlUrl,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_WEB_CLIENT_ID: webClient.userPoolClientId,
        WEB_CLIENT_CREDENTIALS_SECRET_ARN: webClientCredentialsSecret.secretArn,
      },
    });

    // Grants the app's compute role (auto-created for Platform.WEB_COMPUTE
    // per `AppProps.computeRole`'s own doc comment) read access to the
    // secret whose ARN was just passed above — the exact
    // `geminiApiKeySecret.grantRead(fn)` pattern `api-stack.ts` already
    // uses, applied to `App` (which implements `iam.IGrantable` via
    // `grantPrincipal`) instead of a Lambda.
    webClientCredentialsSecret.grantRead(this.app);

    this.branch = this.app.addBranch('Branch', {
      branchName,
      stage: envName === 'prod' ? 'PRODUCTION' : 'DEVELOPMENT',
    });

    // Finding #3 above — domain association is its own construct, mapped
    // onto the branch afterward, not an inline App/Branch prop.
    this.domain = this.app.addDomain('Domain', {
      domainName: webDomain,
    });
    this.domain.mapRoot(this.branch);

    new cdk.CfnOutput(this, 'AppId', {
      value: this.app.appId,
      description: 'Amplify Hosting app id for the Next.js web dashboard.',
      exportName: `Parimaan-${envName}-FrontendAppId`,
    });

    new cdk.CfnOutput(this, 'DefaultDomain', {
      value: this.app.defaultDomain,
      description: 'Amplify Hosting default (amplifyapp.com) domain, before DNS for the custom domain is confirmed.',
      exportName: `Parimaan-${envName}-FrontendDefaultDomain`,
    });
  }
}
