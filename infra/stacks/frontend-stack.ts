import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from 'aws-cdk-lib';
import type { CfnBranch } from 'aws-cdk-lib/aws-amplify';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Secret as SecretsManagerSecret } from 'aws-cdk-lib/aws-secretsmanager';
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
 * 4. **Build spec, found live via a real build (not assumed).** Amplify's
 *    build image has no `pnpm` pre-installed; its own auto-detected default
 *    build spec correctly identified this as a pnpm project (from the root
 *    `package.json`'s `packageManager` field) but failed immediately with
 *    `pnpm: command not found` — `corepack enable` (which activates the
 *    exact pinned version) is never run implicitly. This repo is also a
 *    pnpm-workspace monorepo with the Next.js app under `web/`, not at the
 *    repo root, which Amplify's monorepo `applications:`/`appRoot` build
 *    spec shape is required to express. See the explicit `buildSpec` below.
 * 5. **The `App`-level `buildSpec` alone does nothing for an actual build.**
 *    Found live, a second real-build round after fixing #4: setting
 *    `buildSpec` on `App` alone (confirmed correctly stored there via
 *    `aws amplify get-app`) did not stop a real build from running
 *    Amplify's auto-detected default — the exact same `pnpm: command not
 *    found` failure recurred. Reading the deployed `Branch`'s own
 *    `buildSpec` back showed `None`. Amplify's build service resolves the
 *    effective spec from the `Branch`, not inherited from the `App`, for an
 *    actual build run — the same `buildSpec` is now passed to `addBranch`
 *    too, which is what actually took effect.
 * 6. **`baseDirectory`/`buildPath`/`AMPLIFY_MONOREPO_APP_ROOT`, found live
 *    via a THIRD real build.** #4/#5 got a real `next build` to complete
 *    successfully, only to hit a new failure immediately after:
 *    `Failed to find the deploy-manifest.json file in the build output`
 *    (Amplify's own SSR-compute post-processing step). AWS's own monorepo
 *    docs (`monorepo-configuration.html`) — not the single-app Next.js SSR
 *    doc page #4 was verified against — reveal three requirements none of
 *    which are guessable from that page alone: `artifacts.baseDirectory`
 *    is relative to the MONOREPO ROOT, not `appRoot` (their own worked
 *    example: `baseDirectory: packages/nextjs-app/.next` for `appRoot:
 *    packages/nextjs-app` — this stack's own previous `.next` pointed at a
 *    directory that doesn't exist at the repo root); `buildPath: '/'` runs
 *    install/build from the monorepo root (replacing the earlier `cd ..`
 *    hack, which never affected Amplify's own artifact-resolution step,
 *    only this stack's own `preBuild` commands); and pnpm/Turborepo
 *    monorepos need a root `.npmrc` with `node-linker=hoisted` — AWS's own
 *    docs state plainly that these "require additional configuration"
 *    beyond npm/Yarn/Nx workspaces. `AMPLIFY_MONOREPO_APP_ROOT` (matching
 *    `appRoot` exactly) is also required as an explicit environment
 *    variable for a CDK/CloudFormation-deployed app — the Amplify Console
 *    sets it automatically when a human configures "My app is a monorepo"
 *    there, but nothing sets it automatically for this stack.
 *
 * See SYSTEM_DESIGN.md §9.2 and E2E_MVP_PLAN.md §24.2.6 for the full design
 * rationale.
 */
export class FrontendStack extends cdk.Stack {
  public readonly app: amplify.App;
  public readonly branch: amplify.Branch;
  /**
   * Undefined until the custom domain's DNS is actually verified (see
   * `enableCustomDomain` context in the constructor below) — a real,
   * separate manual-setup gap discovered live, same shape as the GitHub PAT
   * one: Amplify refuses ANY update to a `Domain` resource while it sits in
   * `PENDING_VERIFICATION` (confirmed live — a branch-name-only change
   * failed and rolled back an otherwise-unrelated Branch update, because
   * CloudFormation bundles both into one changeset). Until a human adds the
   * certificate's DNS validation CNAME record at wherever `dev.parimaan.app`
   * is actually hosted, this stack skips provisioning the domain at all —
   * the app still builds/deploys and is reachable at its default
   * `*.amplifyapp.com` domain (`DefaultDomain` output below) in the
   * meantime.
   */
  public readonly domain: amplify.Domain | undefined;

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
    // A real bug, found live once the GitHub connection actually existed to
    // surface it: this repo has exactly one git branch, `main` — every
    // stack in this project (network/data/auth/api) already deploys from
    // it regardless of AWS environment (dev vs. prod is an account/stack
    // distinction, never a separate git branch). The original `'dev'` here
    // assumed a git branch that was never created, and Amplify's own
    // `git clone` failed outright the first time this connected to a real
    // repo (`fatal: Remote branch dev not found in upstream origin`).
    // Locked to `'main'` for both envs until/unless this project actually
    // adopts a real multi-branch git workflow — a decision to make
    // deliberately later, not to default into silently here.
    const branchName = 'main';

    // Optional: a GitHub PAT for the source-control connection (finding #1
    // above). Absent in normal dev iteration until a human completes the
    // one-time manual PAT-creation step documented there; the app still
    // deploys without it, just with no linked repository.
    const sourceCodeProvider = this.resolveGitHubSourceCodeProvider();

    const nextAuthSecret = this.createNextAuthSecret(envName);
    const buildSpec = this.buildAmplifyBuildSpec();

    this.app = new amplify.App(this, 'App', {
      appName: `parimaan-${envName}-web`,
      // Finding #2 above — SSR Next.js needs WEB_COMPUTE, not the WEB
      // (static-only) default.
      platform: amplify.Platform.WEB_COMPUTE,
      buildSpec,
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
        NEXTAUTH_SECRET_ARN: nextAuthSecret.secretArn,
        // Finding #6 (buildAmplifyBuildSpec's own doc) — required by
        // Amplify's own monorepo build support; must match `appRoot`
        // exactly. The Amplify Console sets this automatically when a
        // human configures "My app is a monorepo" there — a CDK/
        // CloudFormation-deployed app gets no such automatic behavior and
        // must set it explicitly (confirmed via AWS's own monorepo docs).
        AMPLIFY_MONOREPO_APP_ROOT: 'web',
      },
    });

    // Grants the app's compute role (auto-created for Platform.WEB_COMPUTE
    // per `AppProps.computeRole`'s own doc comment) read access to both
    // secrets whose ARNs were just passed above — the exact
    // `geminiApiKeySecret.grantRead(fn)` pattern `api-stack.ts` already
    // uses, applied to `App` (which implements `iam.IGrantable` via
    // `grantPrincipal`) instead of a Lambda.
    webClientCredentialsSecret.grantRead(this.app);
    nextAuthSecret.grantRead(this.app);

    this.branch = this.createBranch(branchName, envName, buildSpec);

    // Finding #3 above — domain association is its own construct, mapped
    // onto the branch afterward, not an inline App/Branch prop.
    //
    // Gated behind `enableCustomDomain` (default off) — a real gap found
    // live: Amplify refuses any update to a `Domain` resource while its
    // certificate sits in `PENDING_VERIFICATION` (the DNS CNAME record for
    // cert validation was never added at wherever `dev.parimaan.app` is
    // actually hosted), and CloudFormation bundles Domain into the same
    // changeset as Branch — so an otherwise-unrelated branch update failed
    // and rolled back with it. Once a human completes that one-time DNS
    // step and re-deploys with `-c enableCustomDomain=true`, this
    // provisions normally; until then the app is reachable at its default
    // `*.amplifyapp.com` domain (`DefaultDomain` output below), which needs
    // no DNS at all.
    const enableCustomDomain = this.node.tryGetContext('enableCustomDomain') === 'true';
    if (enableCustomDomain) {
      this.domain = this.app.addDomain('Domain', {
        domainName: webDomain,
      });
      this.domain.mapRoot(this.branch);
    }

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

  /**
   * NextAuth's own JWT session strategy needs a stable signing/encryption
   * secret (`NEXTAUTH_SECRET`) — without one, NextAuth falls back to an
   * ephemeral auto-generated value in development only; in a real
   * multi-instance Amplify Hosting SSR deployment this would mean every
   * instance signs with a different secret and sessions break
   * unpredictably across requests. A real gap S3 flagged explicitly ("No
   * NEXTAUTH_SECRET is wired... needed for real deploy time") and left for
   * follow-up rather than inventing — closed here, same
   * Secrets-Manager-ARN-as-env-var pattern as `webClientCredentialsSecret`,
   * except this secret holds a single plain random string, not a JSON
   * object — CDK's `Secret` construct with no `generateSecretString`
   * override already generates exactly that (a plain random string
   * `SecretString`, not a JSON envelope), so no `secretStringTemplate`/
   * `generateStringKey` pair is needed here. Extracted from the constructor
   * purely to stay under this repo's `max-lines-per-function` lint rule —
   * no behavior change from inlining.
   */
  private createNextAuthSecret(envName: 'dev' | 'prod'): Secret {
    return new SecretsManagerSecret(this, 'NextAuthSecret', {
      secretName: `parimaan/nextauth-secret-${envName}`,
      description: "NextAuth's JWT session signing/encryption secret for the web dashboard.",
    });
  }

  private createBranch(branchName: string, envName: 'dev' | 'prod', buildSpec: BuildSpec): amplify.Branch {
    const branch = this.app.addBranch('Branch', {
      branchName,
      stage: envName === 'prod' ? 'PRODUCTION' : 'DEVELOPMENT',
      // Finding #5, found live: the `App`-level `buildSpec` above is not
      // enough on its own — a real build against a branch with no explicit
      // `buildSpec` of its own ran Amplify's auto-detected default (the
      // exact "pnpm: command not found" failure finding #4 already fixed
      // at the App level) rather than inheriting it, confirmed by reading
      // the deployed branch's own `buildSpec` back as `None` even after the
      // App's `buildSpec` was correctly set. Amplify's build service
      // resolves the effective spec from the Branch, not the App, for an
      // actual build run — passing the identical spec here is what
      // actually takes effect.
      buildSpec,
      // `AMPLIFY_MONOREPO_APP_ROOT` (finding #6) is set at both App and
      // Branch level, defensively, for the identical reason `buildSpec`
      // needed both (finding #5) — Amplify's own internal monorepo
      // orchestration reads this before running any build command, and
      // this stack has already found once that an App-level-only setting
      // does not reliably reach what a real build run actually uses.
      environmentVariables: {
        AMPLIFY_MONOREPO_APP_ROOT: 'web',
      },
    });

    // Finding #7, found live via a THIRD real build (after #6's baseDirectory
    // fix): `next build` completed successfully every time, yet Amplify kept
    // failing right after with "Failed to find the deploy-manifest.json file
    // in the build output". Root cause (confirmed against AWS CDK GitHub
    // issue #25679 and discussion #24574, since neither AWS's own SSR nor
    // monorepo doc pages mention this): the CloudFormation `AWS::Amplify::
    // Branch` resource has a `Framework` field that the Amplify Console sets
    // automatically when a human picks "Next.js" during app setup — nothing
    // does this for a CDK-deployed app. Without it, Amplify's build
    // orchestrator never runs its internal Next.js SSR adapter step (the one
    // that actually produces `deploy-manifest.json` from `.next` output),
    // regardless of how correct the buildSpec otherwise is. The L2 `Branch`
    // construct doesn't expose this property, so it's set on the underlying
    // L1 `CfnBranch`.
    (branch.node.defaultChild as CfnBranch).framework = 'Next.js - SSR';

    return branch;
  }

  /**
   * Finding #1 (class doc comment above): a GitHub PAT-based source-control
   * connection, present only once a human has completed the one-time
   * manual PAT-creation step and supplied its CDK context values. Extracted
   * from the constructor purely to stay under this repo's
   * `max-lines-per-function` lint rule — no behavior change from inlining.
   */
  private resolveGitHubSourceCodeProvider(): amplify.GitHubSourceCodeProvider | undefined {
    const githubTokenSecretName = this.node.tryGetContext('githubTokenSecretName') as string | undefined;
    const githubOwner = this.node.tryGetContext('githubOwner') as string | undefined;
    const githubRepo = this.node.tryGetContext('githubRepo') as string | undefined;

    if (!githubTokenSecretName || !githubOwner || !githubRepo) {
      return undefined;
    }

    return new amplify.GitHubSourceCodeProvider({
      owner: githubOwner,
      repository: githubRepo,
      oauthToken: cdk.SecretValue.secretsManager(githubTokenSecretName),
    });
  }

  /**
   * Finding #4 (class doc comment above): a monorepo-aware build spec,
   * found necessary only via a real build against the live deployed app —
   * Amplify's own auto-detected default correctly identified this as a
   * pnpm project but never runs `corepack enable`, and has no way to know
   * the Next.js app lives under `web/`, not the repo root, without an
   * explicit `applications:`/`appRoot` block. Extracted from the
   * constructor purely to stay under this repo's `max-lines-per-function`
   * lint rule — no behavior change from inlining.
   *
   * Finding #6, found live via a THIRD real build (the first two rounds
   * got past `pnpm: command not found` and then past the Branch-level
   * `buildSpec` gap, only to hit `Failed to find the deploy-manifest.json
   * file in the build output` — Amplify's own SSR-compute post-processing
   * step, confirmed via AWS's own monorepo docs
   * (`docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html`),
   * requires THREE things this earlier version was missing, none of them
   * guessable from the single-app (non-monorepo) Next.js SSR doc page
   * alone:
   * 1. `buildPath: '/'` — install/build commands run from the monorepo
   *    ROOT (replacing the manual `cd ..` hack, which only affected the
   *    `preBuild` phase's own commands, not Amplify's own internal
   *    artifact-resolution step).
   * 2. `artifacts.baseDirectory` is relative to the MONOREPO ROOT, not
   *    `appRoot` — AWS's own worked example states this explicitly:
   *    `baseDirectory: packages/nextjs-app/.next` for `appRoot:
   *    packages/nextjs-app`. The previous `.next` (implicitly relative to
   *    `appRoot`) pointed Amplify's own manifest-generation step at a
   *    `.next` directory that doesn't exist at the repo root, which is
   *    exactly what "Failed to find the deploy-manifest.json file" meant.
   * 3. A root-level `.npmrc` with `node-linker=hoisted` — AWS's own docs
   *    state plainly that "Turborepo and pnpm apps require additional
   *    configuration" beyond npm/Yarn/Nx workspaces, and this is the
   *    specific requirement (see the repo-root `.npmrc`, new this same
   *    commit).
   */
  private buildAmplifyBuildSpec(): BuildSpec {
    return BuildSpec.fromObjectToYaml({
      version: 1,
      applications: [
        {
          appRoot: 'web',
          frontend: {
            buildPath: '/',
            phases: {
              preBuild: {
                // node-linker=hoisted is scoped to THIS build container only
                // (written here, not committed to the repo) — a repo-root
                // .npmrc broke `server-only` module resolution in the repo's
                // own CI `web` test suite, confirmed via a real failed PR
                // check (10 test files failing with
                // `Cannot find module 'server-only'`) that only started
                // after a committed .npmrc was added.
                commands: [
                  'corepack enable',
                  'echo "node-linker=hoisted" > .npmrc',
                  'pnpm install --frozen-lockfile',
                ],
              },
              build: {
                commands: ['pnpm --filter @parimaan/web build'],
              },
            },
            artifacts: {
              baseDirectory: 'web/.next',
              files: ['**/*'],
            },
            cache: {
              paths: ['node_modules/**/*', 'web/.next/cache/**/*'],
            },
          },
        },
      ],
    });
  }
}
