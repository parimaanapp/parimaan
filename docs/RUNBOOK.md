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
