# Parimaan — Technical Implementation Plan

> **⚠️ SUPERSEDED — historical reference only.**
> This document (v0.1) was superseded by [`../E2E_MVP_PLAN.md`](../E2E_MVP_PLAN.md) v2.0 (LOCKED).
> It is retained for history. Do not plan or build from it.

**Version:** 0.1
**Owner:** Amogh Kulkarni
**Last updated:** 2026-07-29
**Status:** SUPERSEDED — see banner above
**Companions:** [PRD v0.3](../PRD.md) · [System Design v0.1](../SYSTEM_DESIGN.md)

---

## 1. How to use this doc

This is the "Monday morning" document — what to open when you sit down to work. It answers:

- **Before month 1:** what accounts, tools, and reading you need to line up.
- **Month 1:** a week-by-week plan with concrete deliverables.
- **Months 2–6:** a sprint-level plan with milestones you can measure yourself against.
- **When stuck:** which spike or investigation to run instead of pushing forward blindly.

**Time budget:** ~10 hrs/week × 26 weeks = ~260 hrs. Design system + UX wireframes happen in parallel via Claude Design (not blocking backend work).

**Golden rule:** if a week goes off-plan, don't compress the next week — slide the plan. Faking progress compounds.

---

## 2. Prerequisites (do these before week 1)

### 2.1 Accounts to open

| Account | Cost | Notes |
|---|---|---|
| **AWS** (personal, for dev) | $0 to open; free tier 12 mo | Enable MFA, root credentials in 1Password, create IAM admin user for daily work |
| **AWS** (prod account) | $0 to open | Do NOT use dev account for prod — hard separation from day 1 |
| **AWS Organizations** | Free | Link the two accounts; enables consolidated billing |
| **Apple Developer** | $99/yr | Required to submit builds; can wait until week 20 but enrollment takes ~1 wk |
| **Google Play Developer** | $25 one-time | Set up now; enrollment is instant |
| **Google Cloud** (for OAuth client) | Free | Only used for OAuth Client ID for Cognito Google IdP |
| **Firebase** project (for FCM) | Free | Push notification delivery |
| **GitHub** | Free (private repos) | Repo host + CI |
| **Namecheap / other registrar** | ~$25 | `parimaan.app` + `parimaan.in` |
| **PostHog** | Free tier | Sign up when analytics land (month 6) |

### 2.2 AWS Activate application

- File as soon as you have a sole-prop entity or company registration.
- Application URL: `aws.amazon.com/activate/founders`
- Ask for **$1,000 credits**; approval is usually 1–2 weeks.
- Apply BEFORE spinning up meaningful infra so credits cover early usage.

### 2.3 Tools to install (mac)

```bash
# Node + package managers
brew install node
npm install -g pnpm@latest

# AWS tooling
brew install awscli
aws configure sso    # set up SSO profile for both accounts

# CDK
npm install -g aws-cdk

# Flutter
brew install --cask flutter
flutter doctor       # follow the instructions until all green

# Postgres client
brew install postgresql@16
# Also install a GUI: TablePlus or Postico

# Additional
brew install jq gh direnv
gh auth login
```

Verify:
```bash
node --version    # ≥ 20
pnpm --version    # ≥ 9
cdk --version     # ≥ 2.140
flutter --version # ≥ 3.24
aws --version     # ≥ 2.15
```

### 2.4 IDE + extensions

- **VS Code** (recommended for backend + web)
- Extensions: Dart, Flutter, AWS Toolkit, GraphQL, Prisma (for the SQL syntax highlighting), ESLint, Prettier
- **Xcode** (required for iOS builds)
- **Android Studio** (required for Android SDK; can edit Flutter in VS Code)

### 2.5 Domain + brand precautions (30 min, do NOW)

- Buy `parimaan.app`, `parimaan.in`, `parimaan.com` if available. ~$25.
- Grab `@parimaanapp` on X, Instagram, YouTube, Threads. Free.
- Run a **free IP India public search** in Class 9 (software), Class 42 (SaaS), Class 30 (food) for "Parimaan". If clean, no filing needed yet.

### 2.6 Reading before code

Do these in a spare 3–4 hrs, before week 1 starts:

- **Flutter** — Dart tour: `dart.dev/language/tour`
- **CDK** — official workshop first two chapters: `cdkworkshop.com`
- **AppSync** — the "Real-Time Data" chapter of the AWS AppSync developer guide
- **Riverpod** — read `riverpod.dev/docs/introduction/why_riverpod`
- **PRD + System Design** — re-read yours; note any questions

---

## 3. Repo bootstrap (day 1 of week 1)

### 3.1 Create the monorepo

```bash
mkdir parimaan && cd parimaan
git init
gh repo create parimaan --private --source=. --remote=origin

# pnpm workspace
cat > package.json <<'EOF'
{
  "name": "parimaan",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
EOF

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - 'api'
  - 'web'
  - 'shared'
  - 'infra'
EOF

# Node version
echo "20" > .nvmrc
```

### 3.2 Directory scaffold

```bash
mkdir -p mobile web api/src/{resolvers,domain,prompts,shared} \
         shared/generated infra/{stacks,bin,lib} \
         recipes docs .github/workflows

# Move existing PRD, system design, this plan into docs/
mv PRD.md SYSTEM_DESIGN.md TECHNICAL_IMPLEMENTATION_PLAN.md docs/
```

### 3.3 Baseline `.gitignore`

```bash
cat > .gitignore <<'EOF'
node_modules/
dist/
build/
.env
.env.local
.env.*.local
*.log
.DS_Store
cdk.out/
.cdk.staging/
coverage/
.flutter-plugins
.flutter-plugins-dependencies
.dart_tool/
.pub-cache/
.pub/
ios/Pods/
ios/.symlinks/
android/.gradle/
android/local.properties
android/**/build/
EOF
```

### 3.4 First commit

```bash
git add .
git commit -m "chore: bootstrap monorepo"
git branch -M main
git push -u origin main
```

### 3.5 Branch protection

On GitHub: Settings → Branches → add rule for `main` → require PR, require status checks, no force push.

---

## 4. Month 1 — week-by-week

### Week 1 — AWS foundation + Cognito

**Goal:** you can sign into a placeholder screen with Google via a real Cognito user pool.

**Deliverables**
- Two AWS accounts (dev, prod) under AWS Organizations
- CDK bootstrap in both accounts
- `network-stack` and `auth-stack` deployed to dev
- Google OAuth client created in Google Cloud Console
- Cognito user pool with Google IdP working (verified via Cognito Hosted UI in a browser)

**Steps**

1. AWS accounts + Organizations + admin IAM users (~2 hrs)
2. `pnpm --filter infra add -D aws-cdk-lib constructs typescript ts-node @types/node` (~30 min)
3. Write `infra/bin/parimaan.ts` — the CDK app entrypoint (~30 min)
4. Write `infra/stacks/network-stack.ts` — VPC with 2 AZs + isolated subnets (~2 hrs; refer to skeleton in §6)
5. Google Cloud Console: OAuth 2.0 Client ID, redirect URIs (Cognito Hosted UI URL) (~1 hr)
6. Write `infra/stacks/auth-stack.ts` — Cognito user pool + Google IdP + app clients (~2 hrs)
7. `cdk bootstrap && cdk deploy AuthStack NetworkStack --profile parimaan-dev` (~1 hr, expect debugging)
8. Verify: open Cognito Hosted UI → "Continue with Google" → land on placeholder redirect (~30 min)

**Definition of done**
- `cdk deploy --all --profile parimaan-dev` succeeds cleanly
- You can complete the Cognito Google sign-in flow in a browser and see JWT tokens in the redirect URL
- `README.md` in `infra/` documents the deploy commands

**If stuck**
- Cognito → Google IdP config has a known gotcha: attribute mapping. Look up the AWS blog "Cognito with Google IdP" if attributes come back empty.

---

### Week 2 — Flutter scaffold + Google SSO end-to-end

**Goal:** the Flutter app can sign in with Google and print the user's email on a screen.

**Deliverables**
- Flutter app scaffolded with Riverpod + go_router + Ferry
- Cognito Hosted UI flow integrated (via `amplify_auth_cognito` — the one Amplify library we DO use, because rolling OAuth by hand in Flutter is a two-week detour)
- Signed-in email displayed on a home screen
- Sign-out works

**Steps**

1. `flutter create --org app.parimaan --project-name parimaan mobile` (~30 min)
2. Configure iOS bundle ID + Android application ID to `app.parimaan.mobile` (~30 min)
3. Add deps to `pubspec.yaml`: `flutter_riverpod`, `go_router`, `amplify_flutter`, `amplify_auth_cognito`, `flutter_secure_storage`, `ferry`, `gql`, `logger` (~30 min)
4. Configure Amplify with your dev Cognito pool (via `amplifyconfiguration.json` generated from CDK outputs) (~1 hr)
5. Build a login screen with a single "Continue with Google" button that calls `Amplify.Auth.signInWithWebUI` (~1 hr)
6. Build a home screen that reads the current user's email + a sign-out button (~1 hr)
7. Handle URL scheme (`parimaan://`) and universal links for OAuth callback on iOS + Android (~2 hrs; this is the fiddly part)
8. Test on both iOS Simulator and Android Emulator (~1 hr)

**Definition of done**
- Sign-in works on both iOS Simulator and Android Emulator
- Sign-out clears tokens and returns to login
- App relaunches to home screen if a session exists (no re-login required)

**If stuck**
- Universal Links on iOS are notoriously tricky. Follow the Amplify docs exactly; do NOT copy-paste from Stack Overflow answers older than 2024.

---

### Week 3 — Data stack + first end-to-end mutation

**Goal:** `createHousehold` mutation works end-to-end from Flutter → AppSync → Lambda → Postgres.

**Deliverables**
- `data-stack` deployed (Aurora Serverless v2 with auto-pause, S3 buckets, DynamoDB cache, RDS Proxy)
- `api-stack` deployed with AppSync + a single Lambda resolver for `createHousehold`
- First Postgres migration run (creates `users`, `households`, `household_memberships`, `household_settings` tables)
- Flutter home screen has a "Create household" button that succeeds

**Steps**

1. Write `infra/stacks/data-stack.ts` — Aurora Serverless v2 cluster, RDS Proxy, S3 buckets, DynamoDB (~3 hrs, referencing §6 skeleton)
2. `cdk deploy DataStack --profile parimaan-dev` (~1 hr, first Aurora deploy is slow)
3. Set up `node-pg-migrate` in `api/` package, write migration `001-baseline.sql` matching System Design §7.1 (~2 hrs)
4. Write `infra/stacks/api-stack.ts` — AppSync API, hello-world Lambda, RDS Proxy wiring (~2 hrs)
5. Write `api/src/resolvers/createHousehold.ts` — the first resolver (~1 hr)
6. `cdk deploy ApiStack` and run migrations from your local machine against Aurora via SSH tunnel or a temporary public endpoint (~1 hr)
7. Wire Flutter to call the mutation via Ferry (~2 hrs)

**Definition of done**
- Tapping "Create household" in Flutter creates a row in `households` and `household_memberships`
- The mutation returns the household with a 6-char invite code
- Row-level security policy applied on the tables

**If stuck**
- RDS Proxy takes ~15 min to become available after CDK deploy. Don't retry deploys in a panic — check the console first.
- Aurora Serverless v2 with auto-pause has a cold resume of ~15s. First query after idle may time out; retry.

---

### Week 4 — Household settings, join by code, empty states

**Goal:** end of week, you can sign in on two devices with two Google accounts, create a household on one, join it from the other, and configure meal structure.

**Deliverables**
- Additional mutations: `joinHousehold`, `updateHouseholdSettings`
- Household settings screen (meals enabled, meal structure, cuisine tier1, dietary tags)
- Empty state screens for Pantry, Recipes, Meal Plan, Shopping List
- Bottom nav bar with these five tabs

**Steps**

1. Add resolvers for `joinHousehold`, `updateHouseholdSettings` (~2 hrs)
2. Add `me` query returning user + memberships (~1 hr)
3. Flutter: Riverpod providers for `currentHousehold`, `householdSettings` (~1 hr)
4. Settings screen with form for meal structure (default 1-2-1) — use standard sliders/steppers, NOT drag (~3 hrs)
5. Empty state screens with copy + a placeholder illustration each (~2 hrs)
6. Bottom nav bar wiring (~1 hr)

**Definition of done**
- Two-device demo: create + join works, settings sync via AppSync subscription (add `onHouseholdChanged` subscription this week)
- All five tabs open to their empty states
- Sign-out from any device works; re-login preserves household selection

**If stuck**
- If AppSync subscriptions don't fire, check that the Lambda authorizer on subscription connect returns `{isAuthorized: true}` — this is a common misconfiguration.

**End of month 1 milestone**
- Working Cognito Google SSO on both platforms
- Household create/join with 5-member cap enforced
- Household settings persisted and synced
- CDK stacks deployed to dev; nothing in prod yet

---

## 5. Months 2–6 — sprint plan

### Month 2 — Pantry + Recipes (manual + AI freeform parse)

**Sprint goal:** you can add pantry items manually, create recipes manually or from a URL or from freeform text, and everything syncs across devices.

Week 5 — Pantry CRUD + local Drift cache
Week 6 — Structured recipe CRUD + role tagging
Week 7 — URL import (JSON-LD parser) + first Bedrock integration (Haiku, freeform parse). **Spike: verify Bedrock availability in `ap-south-1` first day of this week.**
Week 8 — Real-time sync polish, offline read cache tested, month 2 milestone demo

**Milestone:** two-device pantry + recipe management with sub-5-second sync.

### Month 3 — Meal plan + shopping list (the core loop)

**Sprint goal:** the Sunday-evening planning loop from §6 of the PRD works end-to-end.

Week 9 — 7-day calendar UI honoring meal structure config
Week 10 — Recipe picker (filtered by role, favorites/rotation surfaced) + auto-fill rotation logic
Week 11 — Shopping list generation with staples exclusion, "Have it" flow
Week 12 — "Mark as made" → pantry deduction, month 3 milestone

**Milestone:** you can plan a full week, generate a shopping list, mark items as bought or "have it," and the pantry updates correctly on both devices.

### Month 4 — Curated library + sharing + web dashboard (read)

Week 13 — Author the 50-recipe curated library (30 North Indian + 20 South Indian) as JSON in `recipes/`. **This is content work, not code — schedule it for chunks of writing time.**
Week 14 — Seed curated library on household creation
Week 15 — Shopping list share-as-image (Flutter rendering, upload to S3, share intent) + AI staples note (Haiku)
Week 16 — Next.js web dashboard (read-only) + month 4 milestone

**Milestone:** new households come pre-loaded with 50 recipes; shopping lists share cleanly as images.

### Month 5 — AI features + push notifications

Week 17 — **Bedrock vision spike** on 20 real pantry photos — if accuracy is <60%, replan
Week 18 — Photo pantry AI with confirm-before-write UX
Week 19 — Cook-from-pantry suggestions
Week 20 — FCM push notifications (shopping list changes, today's meal, expiry, activity) + Apple Developer + Play Console setup

**Milestone:** end of month 5, all AI features live and rate-limited; push notifications delivered on both platforms.

### Month 6 — Polish + beta

Week 21 — Onboarding flow, error states, offline read cache, empty states pass
Week 22 — PostHog integration + funnel events + basic dashboards
Week 23 — TestFlight + Play Console internal testing; invite 3–5 households
Week 24 — Bug fixes from beta feedback; deploy prod stacks; **MVP shipped**

**Extra weeks 25–26** if any of the above overflows (they will).

---

## 6. CDK skeleton (starter code)

Put these in `infra/` after the bootstrap in §3.

### 6.1 `infra/bin/parimaan.ts`

```typescript
#!/usr/bin/env node
import { App, Environment } from 'aws-cdk-lib';
import { NetworkStack } from '../stacks/network-stack';
import { AuthStack } from '../stacks/auth-stack';
import { DataStack } from '../stacks/data-stack';
import { ApiStack } from '../stacks/api-stack';
import { FrontendStack } from '../stacks/frontend-stack';
import { ObservabilityStack } from '../stacks/observability-stack';

const app = new App();

const envDev: Environment = { account: process.env.CDK_DEV_ACCOUNT!, region: 'ap-south-1' };
const envProd: Environment = { account: process.env.CDK_PROD_ACCOUNT!, region: 'ap-south-1' };

function stacksForEnv(stage: 'dev' | 'prod', env: Environment) {
  const prefix = `Parimaan-${stage}`;
  const network = new NetworkStack(app, `${prefix}-Network`, { env });
  const auth = new AuthStack(app, `${prefix}-Auth`, { env });
  const data = new DataStack(app, `${prefix}-Data`, { env, vpc: network.vpc });
  const api = new ApiStack(app, `${prefix}-Api`, {
    env, vpc: network.vpc, userPool: auth.userPool,
    dbCluster: data.dbCluster, dbProxy: data.dbProxy,
    uploadsBucket: data.uploadsBucket, exportsBucket: data.exportsBucket,
    cacheTable: data.cacheTable,
  });
  new FrontendStack(app, `${prefix}-Frontend`, { env, api });
  new ObservabilityStack(app, `${prefix}-Obs`, { env, api });
}

stacksForEnv('dev', envDev);
if (process.env.DEPLOY_PROD === '1') stacksForEnv('prod', envProd);

app.synth();
```

### 6.2 `infra/stacks/network-stack.ts`

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Vpc, SubnetType, GatewayVpcEndpointAwsService, InterfaceVpcEndpointAwsService }
  from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkStack extends Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,             // cost saver; use VPC endpoints instead
      subnetConfiguration: [
        { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'public',   subnetType: SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // Endpoints so Lambda can reach S3/DynamoDB/Bedrock without NAT
    this.vpc.addGatewayEndpoint('S3',       { service: GatewayVpcEndpointAwsService.S3 });
    this.vpc.addGatewayEndpoint('DDB',      { service: GatewayVpcEndpointAwsService.DYNAMODB });
    this.vpc.addInterfaceEndpoint('Bedrock', { service: new InterfaceVpcEndpointAwsService('bedrock-runtime') });
    this.vpc.addInterfaceEndpoint('SecretsMgr', { service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER });
  }
}
```

### 6.3 `infra/stacks/auth-stack.ts` (excerpt)

```typescript
import { Stack, StackProps, Duration, SecretValue } from 'aws-cdk-lib';
import { UserPool, UserPoolClient, UserPoolIdentityProviderGoogle, OAuthScope, ProviderAttribute }
  from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly appClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,        // Google only
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
    });

    // Google IdP — client ID / secret from Secrets Manager
    new UserPoolIdentityProviderGoogle(this, 'GoogleIdp', {
      userPool: this.userPool,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecretValue: SecretValue.secretsManager('parimaan/google-oauth-secret'),
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: ProviderAttribute.GOOGLE_EMAIL,
        fullname: ProviderAttribute.GOOGLE_NAME,
        profilePicture: ProviderAttribute.GOOGLE_PICTURE,
      },
    });

    this.appClient = this.userPool.addClient('MobileClient', {
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: ['parimaan://auth'],
        logoutUrls:   ['parimaan://logout'],
      },
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: 'parimaan-dev' },   // becomes parimaan-dev.auth.ap-south-1.amazoncognito.com
    });
  }
}
```

### 6.4 `infra/stacks/data-stack.ts` (excerpt)

```typescript
import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { DatabaseCluster, DatabaseClusterEngine, AuroraPostgresEngineVersion,
         ClusterInstance, DatabaseProxy, ProxyTarget }
  from 'aws-cdk-lib/aws-rds';
import { Vpc, SubnetType, SecurityGroup, Port } from 'aws-cdk-lib/aws-ec2';
import { Bucket, BlockPublicAccess, LifecycleRule } from 'aws-cdk-lib/aws-s3';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface DataStackProps extends StackProps { vpc: Vpc }

export class DataStack extends Stack {
  public readonly dbCluster: DatabaseCluster;
  public readonly dbProxy: DatabaseProxy;
  public readonly uploadsBucket: Bucket;
  public readonly exportsBucket: Bucket;
  public readonly cacheTable: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const dbSg = new SecurityGroup(this, 'DbSg', { vpc: props.vpc });

    this.dbCluster = new DatabaseCluster(this, 'Aurora', {
      engine: DatabaseClusterEngine.auroraPostgres({ version: AuroraPostgresEngineVersion.VER_16_2 }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      writer: ClusterInstance.serverlessV2('writer', {
        // auto-pause is configured on the cluster itself in newer versions
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      // Aurora Serverless v2 auto-pause: as of 2024-12, enabled via 'serverlessV2AutoPauseSeconds'
      // Confirm the exact CDK property name at build time — has moved between versions.
      securityGroups: [dbSg],
      storageEncrypted: true,
      backup: { retention: Duration.days(7) },
    });

    this.dbProxy = new DatabaseProxy(this, 'DbProxy', {
      proxyTarget: ProxyTarget.fromCluster(this.dbCluster),
      secrets: [this.dbCluster.secret!],
      vpc: props.vpc,
      securityGroups: [dbSg],
      requireTLS: true,
    });

    this.uploadsBucket = new Bucket(this, 'Uploads', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: undefined,   // SSE-S3 default
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.exportsBucket = new Bucket(this, 'Exports', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: Duration.days(30) } as LifecycleRule],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.cacheTable = new Table(this, 'Cache', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });
  }
}
```

### 6.5 `infra/stacks/api-stack.ts` (skeleton only)

Real content lands in weeks 3–5. Structure:

```typescript
// Imports omitted for brevity
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // 1. GraphQL schema from shared/schema.graphql
    // 2. AppSync API with Cognito user pool as default auth
    // 3. Lambda function per resolver (Node.js 20 runtime)
    //    - VPC-attached to reach RDS Proxy
    //    - IAM policy for Bedrock InvokeModel on Sonnet + Haiku ARNs
    //    - IAM policy for S3 (presigned URLs) + DynamoDB (cache table)
    // 4. AppSync data source per Lambda; resolver mapping per field
    // 5. Subscription authorizer Lambda
  }
}
```

Full implementation is a week-3 activity; skeleton exists as a placeholder from week 1.

---

## 7. Development workflow

### 7.1 Git strategy

- `main` is always deployable to dev
- Feature branches named `feat/<area>-<short>` — e.g. `feat/pantry-crud`
- One PR per feature, self-review before merging
- Squash-merge on merge; keeps `main` history readable
- No direct pushes to `main`

### 7.2 PR checklist (for yourself)

Before merging:
- [ ] Tests pass locally
- [ ] `pnpm typecheck` passes
- [ ] `flutter analyze` passes (if mobile changed)
- [ ] Screenshots attached for any UI change
- [ ] Database migration file added if schema changed
- [ ] `docs/` updated if system-level behavior changed

### 7.3 Testing strategy

| Layer | Framework | Coverage target |
|---|---|---|
| Lambda resolvers | Vitest | 80% for domain logic; skip trivial CRUD |
| Flutter | `flutter_test` for widgets; `test` for pure Dart | 60% for state + domain; smoke tests for screens |
| Web | Vitest + React Testing Library | 60% |
| CDK | `aws-cdk-lib/assertions` snapshot + IAM policy assertions | Snapshot all stacks |
| E2E | Detox (mobile) or Playwright (web) | Critical flows only, from month 4 |

### 7.4 Definition of Done — per feature

A feature is done when:
1. It works on iOS and Android
2. It has tests covering the state layer
3. It fails gracefully on network/backend errors (user sees a message, not a crash)
4. It shows a loading state during async work
5. Analytics events fire (from month 6 onward)

### 7.5 Local dev environment

- **Postgres:** connect to dev Aurora via SSH tunnel through a bastion, OR run Postgres locally via `docker compose up` and point migrations at it during rapid iteration
- **Lambda invocation:** `sam local invoke` or just unit-test the resolver function directly; avoid deploying to dev on every change
- **Flutter hot reload:** `flutter run` against dev Cognito + dev AppSync
- **Web hot reload:** `pnpm --filter web dev`

---

## 8. Learning path (weeks 1–8, parallel to build)

Build slows down if you don't learn intentionally.

| Week | Read / watch | Time budget |
|---|---|---|
| 1 | CDK workshop chapters 1–4; AWS Cognito with Google IdP blog | 2 hrs |
| 2 | Flutter cookbook (nav, forms, secure storage); Riverpod tutorial | 2 hrs |
| 3 | AppSync developer guide (queries + mutations); Ferry docs | 2 hrs |
| 4 | Postgres RLS documentation; node-pg-migrate | 1 hr |
| 5 | Drift docs (local persistence); Flutter offline strategies blog posts | 1 hr |
| 6 | JSON-LD Recipe schema spec; a few Indian recipe blog sources | 1 hr |
| 7 | Bedrock docs (Claude specifically); Anthropic prompt engineering guide | 2 hrs |
| 8 | Real-time subscription patterns (AppSync); GraphQL subscription authorization | 1 hr |

---

## 9. Scheduled risk-mitigation spikes

Blockers you can't afford to discover in the last month. Schedule these EARLY.

| Spike | When | Success = |
|---|---|---|
| **Bedrock Claude availability in `ap-south-1`** | Day 1 of week 7 | Model IDs invokable from a dev Lambda; if not, fallback plan documented |
| **JSON-LD parse coverage on Indian recipe blogs** | Week 7 | ≥16 of top 20 sites yield a parseable Recipe; if <12, plan a fallback UX |
| **AppSync subscription with 5 clients** | Week 8 | 5 clients receive an event within 5s; no dropped connections in 30 min soak |
| **Aurora auto-pause resume latency** | Week 3 | First-query after 15 min idle completes within 30s; if worse, disable auto-pause |
| **Bedrock vision accuracy on Indian pantry photos** | Week 17 | ≥60% of proposed items acceptable on 20 test photos; if not, restrict feature to labels/packaged items only |
| **RDS Proxy under concurrent Lambda load** | Week 12 (before real users) | 20 concurrent Lambda invocations complete queries without connection errors |

If any spike fails, replan the affected feature — don't push forward with the assumption it'll be fine.

---

## 10. Milestone definitions of done

| Milestone | Definition of Done |
|---|---|
| **End of month 1** | Two-device Google SSO working; household create/join; settings persist; empty states for all tabs; all deployed to dev; nothing in prod |
| **End of month 2** | Pantry + Recipes CRUD; URL import; freeform AI recipe parse; two-device sync < 5s |
| **End of month 3** | Full core loop: plan a week → generate list → check off → pantry updates. Your household uses it for at least one full week. |
| **End of month 4** | 50 curated recipes shipped; shopping list share-as-image works; web read dashboard live |
| **End of month 5** | Photo pantry AI live (with confirm-before-write); cook-from-pantry suggestions; push notifications delivered on both platforms |
| **End of month 6** | Prod stacks deployed; TestFlight + Play Console distribution; 3+ external households onboarded; PostHog dashboard shows real usage |

---

## 11. What could go wrong (and adjustments)

| Risk | Adjustment |
|---|---|
| Flutter learning takes 4 wks not 1 | Slide months 2–6 by 2 wks; consider dropping web dashboard from MVP to month 7 |
| Bedrock unavailable in `ap-south-1` and cross-region latency is bad | Switch AI features to direct Anthropic API (outside AWS); accept small privacy/complexity tradeoff |
| Auto-pause resume too slow for real UX | Disable auto-pause; DB costs jump to ~$50/mo; still under $100/mo total at beta |
| 50-recipe library takes 4 weeks to author | Ship with 20 recipes; add rest in v1.1; users can bring their own |
| One risky feature (photo pantry) fails accuracy bar | Cut it from MVP; ship without; keep confirm-flow scaffold for v1.1 improvements |
| Solo dev burnout | Take a full week off; the plan slides; do NOT push through |

---

## 12. Cost tracker

Track weekly (put in a note or spreadsheet — CloudWatch Cost Explorer helps):

- Week 1 target: $0 (free tier, no Aurora yet)
- Week 3 target: <$5 (Aurora + RDS Proxy on, minimal usage)
- Week 8 target: <$15/mo run rate
- Month 6 target: <$35/mo run rate

If actual > 2× target for a week, stop and investigate before deploying more.

---

## 13. Open items

Things to resolve during week 1:

1. **Decision: Amplify auth library on mobile — yes or no?** System design leans "hand-rolled"; this plan leans "Amplify auth only, hand-rolled everything else" because pure hand-rolled OAuth in Flutter costs 1–2 weeks we don't have. Confirm.
2. **Decision: prod AWS account provisioning strategy — right now or in month 5?** Provisioning now costs $0 but avoids month-5 surprises. Lean: now.
3. **Decision: Melos or plain `pnpm` for Flutter workspace management?** Flutter is technically standalone (not a pnpm package). Recommendation: keep Flutter separate and use pnpm for JS/TS packages only. Melos not needed for solo dev.
4. **Decision: pgAdmin / TablePlus / Postico for DB inspection?** Preference?
5. **Decision: which Google account for the OAuth client?** Personal or a `parimaan@` alias? Lean: create a `parimaan@` Google account first to keep production auth independent from your personal Google identity.

---

## 14. Decisions log

- Repo: monorepo with pnpm workspaces; Flutter is a peer directory (not a pnpm package).
- Two AWS accounts (dev + prod) under AWS Organizations from day 1.
- CDK app entrypoint deploys both environments; prod deploy gated by env var.
- Cognito Hosted UI + Amplify auth library on Flutter (one Amplify library used); everything else hand-rolled.
- `node-pg-migrate` for schema migrations; migrations run from CI with approval gate for prod.
- GitHub Actions for CI/CD; branch protection on `main`.
- Testing floor: 60% on state layer, 80% on domain logic in Lambda.
- 6 scheduled risk-mitigation spikes; each has a fallback plan if the spike fails.
- Weekly cost tracking; investigate at 2× target.
