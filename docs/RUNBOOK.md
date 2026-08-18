# Parimaan — Operational Runbook

**Version:** 0.1 — stub
**Owner:** Amogh Kulkarni
**Status:** Skeleton. To be filled in W22–W23, before the first production deploy.
**Companion to:** [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) §11 (observability), §12 (environments), §14 (failure modes)

> **This is a stub.** It exists to satisfy the `E2E_MVP_PLAN.md` §8 MVP Definition of Done
> (Docs: "PRD, System Design, E2E plan, RUNBOOK in `docs/`") and to be populated incrementally
> as real operational knowledge accumulates. Every section below is a placeholder.
>
> **Rule:** any incident, rollback, or non-obvious fix encountered during W1–W26 gets written
> here the same day it happens. A runbook written retrospectively in W23 from memory is fiction.

---

## 1. Incident Response

_To be filled in W22–W23._

- **Severity definitions** (SEV1 data loss / SEV2 core loop down / SEV3 degraded / SEV4 cosmetic)
- **Alarm → action map** — one row per CloudWatch alarm in `SYSTEM_DESIGN.md` §11:
  AppSync 5xx > 5% · Aurora CPU > 80% sustained 10 min · Bedrock throttling > 10/5 min · daily AI cost > $5
- **First-response checklist** — where to look, in what order (CloudWatch Logs → X-Ray traces → Aurora metrics → PostHog)
- **Communication** — how and when beta households are notified
- **Post-incident** — writeup location and required contents

---

## 2. Common Issues

_To be filled in as encountered — do not wait for W22._

Anticipated from `SYSTEM_DESIGN.md` §14 failure modes:

- Aurora Serverless v2 cold resume latency after auto-pause (PRD §17.4 lever #2 — auto-pause is non-negotiable, so this is a permanent operational characteristic, not a bug)
- Aurora connection exhaustion (`max_connections`) under burst — the Q1 risk that RDS Proxy was deferred against
- Bedrock throttling / model unavailability in `ap-south-1`
- Malformed AI output → retry → `AIError` surfacing
- AppSync subscription reconnect storms after a push notification fan-out
- Cognito token refresh failures on mobile
- S3 presigned URL expiry during slow uploads
- Deep-link (`parimaan://join?code=`) handling differences between iOS and Android

### Sprint 0 issues encountered (real, logged as they happened)

- **`pnpm@latest` via corepack requires Node ≥22.13**, incompatible with the locked Node 20 Lambda runtime decision. Fixed by pinning `pnpm@9.15.9` explicitly (`packageManager` field in root `package.json`) rather than using `latest`. Local dev Node version and Lambda deployment target don't have to match exactly, but the package manager does need to support whichever Node version is actually active locally.
- **`nvm use` piped through another command (`nvm use 20 | tail -1`) does not persist** — pipes run in a subshell, so PATH changes don't propagate back to the parent shell. Always run `nvm use` unpiped, chained with `&&` to subsequent commands in the same invocation.
- **`verbatimModuleSyntax: true` (inherited from the shared base tsconfig) conflicts with `module: CommonJS`** in `infra/tsconfig.json` — CDK's CommonJS convention doesn't support the strict ESM-syntax-preservation that flag requires. Fixed by overriding `verbatimModuleSyntax: false` for the `infra` package specifically.
- **`exactOptionalPropertyTypes: true` correctly rejected** `{ account: process.env.X }` where `process.env.X` is `string | undefined` — an optional property must be *absent*, not present-with-value-undefined. Fixed with conditional object spread: `...(x ? { account: x } : {})`.

### W1 issues encountered

- **CDK `Vpc` (concrete class) assigned to a parameter typed `IVpc` fails under `exactOptionalPropertyTypes`** — a structural mismatch in aws-cdk-lib's own type declarations (`IVpc.vpnGatewayId` declared `?: string`, `VpcBase`'s implementation is a getter returning `string | undefined`), not a real bug. Confirmed empirically (removed the cast, saw the exact error; confirmed `vpnGatewayId` isn't consumed by any construct that needed it). Fixed with a single narrow, documented `as IVpc` cast at the point of use — not a project-wide flag change.
- **CloudFormation's `AWS::EC2::SecurityGroup` `GroupDescription` has an unusually restrictive allowed-character pattern** — an em-dash (`—`) in a description string produces a real CFN validation warning (would likely fail at actual deploy time, not just a synth-time cosmetic issue). Other resource-facing strings (e.g. CDK `Stack`-level `description` props, which map to the template's top-level `Description` field) don't have this restriction — confirmed by checking whether the same warning recurred elsewhere after the fix. Fixed by using a plain hyphen instead. Worth a quick grep for em-dashes in any new resource-facing string property (not code comments) before adding one.
- **Vitest's default 5000ms `testTimeout` is too tight for `cdk synth`'s cold-start cost on GitHub Actions' shared runners** — passed comfortably on a local warm-cache Mac, then failed in CI on PR #5 with every stack's first `synthesizes without error` test timing out at exactly 5000ms. The cost is aws-cdk-lib + jsii module load/runtime init, paid once per Vitest worker (later synth calls in the same worker are fast). Fixed with `infra/vitest.config.ts` setting `testTimeout: 15_000`. **Lesson: always watch CI run to completion for a new stack's first PR, don't assume local-green implies CI-green** — this one was invisible locally no matter how many times the suite was re-run.
- **`pnpm exec esbuild` (invoked internally by CDK's `NodejsFunction` bundling) couldn't resolve the `esbuild` binary** when `esbuild` was only installed as a devDependency in `infra/`. Root cause, verified: `aws-cdk-lib`'s bundling code detects `esbuild` via a plain `require('esbuild/package.json')` from deep inside its own module tree, which walks Node's CommonJS resolution up through the true top-level `node_modules/` — an `infra/`-scoped, non-hoisted install is never on that path under pnpm's strict per-package linking. Fixed by adding `esbuild` as a **root** devDependency, matching the existing pattern (shared toolchain deps — `typescript`, `eslint`, `vitest` — already live at the root, not per-package).
- **`nodejs20.x` Lambda runtime is already deprecated** (CFN validation warning, confirmed on every `ApiStack` synth): deprecated 2026-04-30, new-resource creation disabled 2027-02-01, updates disabled 2027-03-03. Node 20 was a locked architectural decision (`SYSTEM_DESIGN.md` §18, tied to matching the Lambda runtime with local dev tooling at plan time) — **not silently changed to `nodejs24.x`**; surfaced to the user directly as an open decision point instead. Tracked as unresolved: a runtime bump decision is needed before the `2027-02-01` creation cutoff, and ideally well before, given the deprecation is already in effect today.

---

## 3. Rollback Procedures

_To be filled in W22–W23._

- **CDK stack rollback** — per-stack, and the dependency order that must be respected
- **Database migrations** — `node-pg-migrate down`, and which migrations are irreversible (destructive migrations must be flagged as such at authoring time, not at rollback time)
- **Mobile release rollback** — App Store / Play Console staged-rollout halt; note that a shipped mobile binary cannot be recalled, only superseded
- **Web rollback** — Amplify Hosting revert to previous deployment
- **Feature-flag kill switches** — PostHog flags, and which risky paths each one gates
- **Point-in-time recovery** — Aurora 7-day PITR procedure and RTO/RPO expectations

---

## 4. Contacts

_To be filled in W22–W23._

- **On-call:** Amogh Kulkarni (sole)
- **AWS Support** — plan tier, case URL, account IDs held in the password manager (**never in this file**)
- **Vendor escalation** — PostHog (EU Cloud), Firebase/FCM, Apple Developer, Google Play Console
- **Domain / DNS registrar**
- **Beta household contacts** — held outside the repo; this file records only *how* to reach them, never PII

> **Security constraint:** no AWS account IDs, no phone numbers, no email addresses of beta users,
> no ARNs, and no credentials of any kind in this file. It is committed to the repository.
> Reference the password manager or Secrets Manager by name instead.
