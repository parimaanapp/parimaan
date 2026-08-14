# Parimaan — Development Workflow Plan

**Version:** 0.1 — CONFIRMED, executing (Sprint 0 in progress)
**Owner:** Amogh Kulkarni
**Status:** Confirmed 2026-08-14. Sprint 0 (this document's §5) is being executed now.
**Companion to:** [`PRD.md`](./PRD.md) v0.3, [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) v0.1, [`E2E_MVP_PLAN.md`](./E2E_MVP_PLAN.md) v2.0 (LOCKED)

---

## 0. Two source-doc reference corrections (read before §3)

While reading the three locked docs I could not find two sections the brief referenced. Flagging rather than inventing:

| Referenced as | What is actually there | What this plan uses instead |
|---|---|---|
| System Design §10.3 "testing strategy table" | SD §10.3 is **Authorization checks** (`requireHouseholdMember` preamble). There is **no testing-strategy table anywhere in SYSTEM_DESIGN.md**. | `E2E_MVP_PLAN.md` §8 "MVP overall DoD → Coverage" is the only coverage spec that exists: *Lambda domain-logic ≥80%; Flutter state-layer ≥60%; CDK snapshot tests present.* |
| System Design §7.3 "E2E from month 4" | SD §7.3 is the **DynamoDB single-table design**. No E2E/Detox/Playwright section exists in any doc. | This plan **proposes** E2E introduction at W16 (end of Phase 4) and treats it as a new decision needing your sign-off, not a pre-existing one. |

**Consequence — a real conflict to resolve in Sprint 0:** locked decision #3 (full strict TDD, 80%+ everywhere, per global testing rules) contradicts `E2E_MVP_PLAN.md` §8's Flutter target of **≥60%**. Since E2E_MVP_PLAN v2.0 is LOCKED, this workflow plan cannot silently override it. Sprint 0 Step 8 below routes this through `doc-updater` as an explicit amendment (`§8 Flutter state-layer ≥60% → ≥80%, and add widget/golden coverage`) so the locked doc and the working practice agree. Do not start W1 with the two documents disagreeing.

---

## 1. Purpose & relationship to E2E_MVP_PLAN.md

`E2E_MVP_PLAN.md` v2.0 is the **WHAT and WHEN** — six phases, 26 weeks, 49 screens mapped week by week (§4), 10 workstreams, 15 locked decisions (§10), ~260 hours (§7). It is locked and this document does not touch a single line of its schedule, scope, or decisions. This document is the **HOW** — a reusable process template applied on top of that schedule, defining the repeatable per-feature pipeline (research → plan → TDD → implement → review → docs → commit), which agent fires at which step and why, what strict TDD concretely means for Lambda / Flutter / CDK / E2E, when documentation gets re-synced, and how per-feature gates roll up into E2E_MVP_PLAN §8's per-milestone Definition of Done. When the two documents disagree, E2E_MVP_PLAN wins on *what to build and when*; this document wins on *how the work is executed*. Any change to the former is an amendment requiring explicit sign-off; changes to the latter are process tuning and can be revised at phase boundaries.

---

## 2. The per-feature workflow template

Applies to every unit of work in W1–W26. A "feature" here = one resolver, one screen, one CDK stack, or one coherent slice thereof.

### 2.1 Pipeline

```
  ┌─ 0. SIZE CHECK ──────────────────────────────────────────┐
  │  Trivial (<30 min, no new logic)?  → Fast Lane (§6b)     │
  │  Otherwise → Full Pipeline below                          │
  └───────────────────────────────────────────────────────────┘
                              │
  1. RESEARCH & REUSE   ── (no agent; main session)
     gh search code/repos → Context7/vendor docs → pub.dev/npm → Exa last
                              │
  2. PLAN               ── planner   (always, for any multi-file change)
                        ── architect (ONLY if it deviates from SD/E2E locked decisions)
                              │
  3. RED                ── tdd-guide  → writes failing tests, runs them, confirms RED
                              │
  4. GREEN              ── main session implements minimal passing code
                              │
     ├─ build breaks?   ── build-error-resolver (on demand)
                              │
  5. REFACTOR           ── tdd-guide  → coding-style.md checklist, tests stay green
                              │
  6. DOMAIN REVIEW      ── by what changed (parallel if multiple apply):
        mobile/**          → flutter-reviewer
        api|web|infra|shared/**.ts → typescript-reviewer
        *.sql | RLS | migrations   → database-reviewer
                              │
  7. SECURITY REVIEW    ── security-reviewer (conditional — see §2.3)
                              │
  8. GENERAL REVIEW     ── code-reviewer (always; catches cross-cutting issues)
                              │
  9. DOC SYNC           ── doc-updater (conditional — see §4)
                              │
 10. COMMIT             ── main session; conventional commits; security checklist run
```

### 2.2 Agent assignment table

| # | Step | Agent | Why this agent, here |
|---|---|---|---|
| 1 | Research & Reuse | *none* | Mandated by development-workflow.md step 0. Cheap in main session; spawning an agent adds latency for a search. Non-negotiable for: JSON-LD parsers (W7), Flutter image compression (W17), list-image render (W15), FCM wiring (W20) — all have mature OSS. |
| 2 | Plan | `planner` | Breaks the week's screens/resolvers into ordered, testable units with file paths. Input: the E2E_MVP_PLAN §4 row for that week. |
| 2b | Plan (novel arch) | `architect` | Only when a choice isn't already made in SD §18 or E2E §10. Expected uses: RDS Proxy add/no-add after W3+W11 spikes (Q1), photo-pantry replan if W17 vision spike fails (R5), offline-cache invalidation design (W23/R9). |
| 3 | RED | `tdd-guide` | Owns the invariant that tests exist and **fail** before implementation. Must report the failure output, not just claim it. |
| 4 | GREEN | *none* | Implementation stays in main session — it holds the design-system, schema, and wireframe context. |
| 4b | Build break | `build-error-resolver` | High expected use in Phase 1 (Flutter/Xcode/CocoaPods, CDK bootstrap, Ferry codegen). Reactive only. |
| 5 | REFACTOR | `tdd-guide` | Same agent closes the loop: files <400 lines, functions <50, nesting ≤4, immutable updates, coverage verified. |
| 6 | Domain review | `flutter-reviewer` / `typescript-reviewer` / `database-reviewer` | Chosen by changed paths, not by feature name. A resolver + migration + screen triggers all three, run in parallel. `database-reviewer` is the RLS gatekeeper (SD §6.2 layer 3) — mandatory on every migration. |
| 7 | Security | `security-reviewer` | Conditional — see §2.3. |
| 8 | General | `code-reviewer` | Catches what domain reviewers miss: cross-package contract drift (SDL vs. Ferry vs. Zod), error-handling gaps, hardcoded values, dead code. |
| 9 | Docs | `doc-updater` | Conditional — see §4. |
| 10 | Commit | *none* | `<type>: <description>` per git-workflow.md; security.md checklist run in-session before staging. |

### 2.3 Should `security-reviewer` run on every feature? — Decision: **NO. Trigger-based, with two standing exceptions.**

**Justification.** On a 260-hour budget, a full security pass on a pure-presentation change (e.g. W21's empty-state illustrations) is pure overhead with near-zero yield — it trains you to skim the output, which is worse than not running it. Precision matters more than blanket coverage.

`security-reviewer` **fires** when the diff touches any of:

- Auth/identity: Cognito config, JWT handling, token storage, `amplify_auth_cognito`, deep links (`parimaan://join?code=` is an untrusted input path)
- Authorization: any `requireHouseholdMember` path, the subscription authorizer Lambda, **any RLS policy** (SD §6.2)
- **Any new Lambda resolver** — every one is an internet-reachable, authenticated input surface
- SQL: any migration, any query construction
- Secrets/IAM: Secrets Manager, SSM, CDK IAM policies, bucket policies, presigned-URL generation
- AI: any Bedrock prompt or response path (prompt-injection surface, SD §8.3, and the 4000-char bound in §13.4)
- Uploads/exports: S3 presigned PUT/GET, the >500KB server-side reject (SD §8.5)
- Rate limiting: DDB counters, AppSync throttles
- Third-party SDK addition of any kind

**Two standing exceptions (always run regardless of diff):**
1. **Phase-boundary sweep** — end of W4, W8, W12, W16, W20, W24, full-surface review before the milestone is declared done.
2. **Pre-prod-deploy** — W23, before `deploy-prod.yml` first runs against real user data.

Everything else (theme tokens, widget layout, copy, empty states, icons, PostHog event names) skips it.

---

## 3. TDD specifics for this stack

Extending — not replacing — the coverage targets in `E2E_MVP_PLAN.md` §8 (subject to the §0 amendment). This section adds **sequencing**, not new numbers.

### 3.1 The universal loop

| Phase | Rule | Gate |
|---|---|---|
| RED | Test written and **executed**, failing for the intended reason (not a typo/import error). `tdd-guide` pastes the failure. | No implementation code may be written until RED is shown. |
| GREEN | Minimal code to pass. No speculative generality, no "while I'm here." | Full suite green. |
| REFACTOR | coding-style.md checklist applied; tests untouched. | Suite still green; coverage ≥ target. |

### 3.2 (a) Lambda resolvers — Vitest

- **Test first, in this order:** (1) authorization denial — a non-member of `householdId` gets `ForbiddenError`; (2) Zod input-validation rejections; (3) happy path; (4) transaction rollback (critical for `haveIt` SD §5.7 and `markMade`); (5) failure-mode row from SD §14.
- Pure domain logic (`api/src/domain/`) tested with **zero mocks** — this is where the ≥80% bites hardest and where the real value is: staples-exclusion rules (PRD §9 note), `autoFillWeek` MAX-cap + recency-avoidance, pantry deduction matching.
- Postgres: prefer a real ephemeral Postgres (Testcontainers or local Docker) over mocking `pg`, specifically so **RLS policies are actually exercised**. Mocked DB clients cannot test RLS, and RLS is defense-in-depth layer 3.
- Bedrock: **always** stubbed in unit tests. Real Bedrock calls belong to the W7/W17 spikes and to a tiny manually-run contract suite — never in CI (cost + nondeterminism).
- **AI-specific RED test that must exist for all 4 features:** malformed/non-JSON model output → retry once → second failure → `AIError` surfaced as a friendly message (SD §8.2 steps 5–6, §14).

### 3.3 (b) Flutter — `flutter_test` + Riverpod

Given locked decision #3, all three layers are TDD'd:

| Layer | Tool | RED looks like |
|---|---|---|
| Domain/use-cases | plain `test` | Pure Dart, no widgets. Fastest, highest value — put logic here rather than in widgets so this layer carries most of the 80%. |
| State (Riverpod) | `ProviderContainer` + overrides | Provider emits `loading → data`/`error`; family providers correctly scoped by `householdId`; repository overridden with a fake. |
| Widgets | `testWidgets` + `pumpWidget` | Empty state renders before data; error state on repo throw; tap `+ add` calls the right notifier method; 5-member-cap "household full" state renders. |
| Golden | `matchesGoldenFile` | **Only for the 30 design-system components in `lib/shared/ui/` (WS-5), not per screen.** Per-screen goldens on 49 screens would generate constant churn against a tight budget. |

**Explicit guidance to keep this affordable:** push logic *out* of widgets and into domain/state. Thin widgets are cheap to test; fat widgets are where strict TDD on UI actually burns hours.

### 3.4 (c) CDK — `aws-cdk-lib/assertions`

- **Fine-grained assertions before snapshots.** RED = `Template.fromStack(...).hasResourceProperties(...)` asserting the property that *matters* — Aurora `AutoPause: true` (PRD §17.4 lever #2, "non-negotiable"), S3 `BlockPublicAccess: ALL`, 30-day lifecycle on exports, Bedrock `InvokeModel` scoped to specific model ARNs (SD §13.3), log retention 7d dev / 30d prod.
- **Then** add one snapshot per stack as a change-detector. Snapshots alone are near-worthless — they go green on any `--update` and encode nothing about intent.
- Coverage on `infra/` is measured as "every stack has fine-grained assertions for its security- and cost-critical properties," not as a line-coverage percentage. Line coverage on declarative CDK is a vanity number.

### 3.5 (d) E2E — proposed introduction at W16

Since no E2E decision exists in the source docs (§0), this is a **proposal**:

- **Introduce at W16** (end of Phase 4), not month 4 start — the core loop only stabilizes at W12 and W13–W14 are content weeks. Writing E2E against a still-moving core loop is how you get a flaky suite you stop trusting.
- **Detox (mobile)** — exactly three flows, no more: (1) sign in → create household → configure settings; (2) plan week → auto-fill → generate list; (3) have-it → item lands in pantry.
- **Playwright (web)** — one flow: sign in → dashboard reads render.
- **E2E is the one place TDD is relaxed** — write E2E *after* the flow is manually verified working. E2E-first against an unbuilt UI produces selector churn, not design pressure. `e2e-runner` owns authoring and CI wiring.
- Run nightly + pre-release, **not** on every PR (cold-start and device-farm time will dominate a 10 hr/week budget otherwise).

---

## 4. Documentation sync cadence

`doc-updater` is **trigger-based, not calendar-based** — with one calendar backstop.

### 4.1 Triggers (fire immediately, same session)

| Trigger | What gets updated |
|---|---|
| Implementation **deviates** from a locked decision (E2E §10 Q1–Q15, SD §18, PRD §14) | Amendment entry in the affected doc + rationale. Deviation is allowed; **silent** deviation is not. |
| A **new architectural decision** is made mid-build (post-`architect`) | Append to SD §18 decisions log. |
| A **spike concludes** (R1–R10, W3/W7/W11/W17/W23) | Result + go/no-go recorded against the E2E §6 risk row. A spike with no written outcome is a spike that will be re-run. |
| GraphQL **SDL changes** (`shared/schema.graphql`) | SD §6.1 SDL block re-synced. SDL is the single source of truth for Ferry + codegen + Zod; drift here breaks three consumers silently. |
| **DB migration** merged | SD §7.1 DDL re-synced, including new RLS policies. |
| **New CDK resource** with cost implications | PRD §17.2 cost table row. |
| **Wireframe deviation** shipped (precedent: Q14's notification-prompt relocation) | Noted against the affected flow. |
| `theme.dart` or design system touched | Diff against `docs/design-tokens-snapshot.json` per locked Q12 **before** proceeding. |

### 4.2 Calendar backstop

- **End of every week (W1–W26):** a 10-minute `doc-updater` pass — update the E2E §4 week row with actual-vs-planned, log hours spent, note carry-over. This is the raw data the §6 velocity checkpoint depends on; without it that checkpoint has nothing to measure.
- **End of every phase (W4/W8/W12/W16/W20/W24):** reconcile all three docs against reality; confirm the §8 milestone DoD row.

### 4.3 Explicitly *not* a trigger

Bug fixes with no behavior change, copy tweaks, refactors that preserve interfaces, dependency bumps. Docs that churn on noise stop being read.

---

## 5. Sprint 0 — worked example: scaffold the monorepo

**The actual next unit of work.** Maps to `E2E_MVP_PLAN.md` §3 Phase 0 / §4 W0, deliverables: *"Monorepo scaffolded (pnpm workspaces + Flutter as peer module), pushed to GitHub with branch protection"* + *"empty repo skeleton per SD §12.2, .nvmrc, .gitignore, GitHub Actions PR workflow, README."* Locked Q13 governs the tooling. Budget: part of Phase 0's ~8 hrs. **No application code.**

| # | Step | Agent | Concrete action | Gate before next step |
|---|---|---|---|---|
| 1 | Research & Reuse | *none* | `gh search repos "pnpm workspace flutter monorepo"`, `gh search code "pnpm-workspace.yaml" path:/ cdk`. Check `aws-cdk` app templates and Flutter `very_good_cli` for structure worth borrowing. Decide adopt-vs-hand-roll. **Do not skip** — dev-workflow.md step 0 is mandatory and scaffolding is the highest-reuse task in the whole project. | Findings noted; adopt/hand-roll decision made. |
| 2 | Plan | `planner` | Produce the exact file/directory manifest for SD §12.2: `mobile/ web/ api/ shared/ infra/{stacks,bin} recipes/ docs/`, root `package.json`, `pnpm-workspace.yaml` (**listing `web`, `api`, `shared`, `infra` — NOT `mobile`**, per Q13), `.nvmrc` (Node 20, per SD §2), `.gitignore` (Node + Dart/Flutter + CDK `cdk.out` + `.env`), `README.md`, `.github/workflows/pr.yml`. Include tsconfig strategy (root base + per-package extends). | Manifest reviewed by you. |
| 2b | Architecture | `architect` | **SKIPPED.** Layout is fully specified by SD §12.2 and locked Q13. No novel decision exists here. | — |
| 3 | RED | `tdd-guide` | Scaffolding is config, not logic — TDD applies as **executable verification**, not unit tests. Write, and watch fail: (a) `pnpm -r install` resolves all 4 TS workspaces; (b) `pnpm -r typecheck` passes on empty packages; (c) `cd mobile && flutter analyze` passes on `flutter create` output; (d) `cd infra && pnpm vitest` runs a placeholder CDK assertions test on an empty stack; (e) `pr.yml` job matrix covers all of the above. All fail now — nothing exists. | Failure output shown for all five. |
| 4 | GREEN | *none* (main) | Create the tree. `flutter create mobile` for the peer directory. `cdk init app --language typescript` inside `infra/`. Minimal `package.json` per workspace. `pr.yml` per SD §12.4: lint, type-check, unit tests, `flutter analyze`, `dart test`. | All five checks from step 3 pass locally. |
| 4b | Build errors | `build-error-resolver` | Standby. Likely hits: CocoaPods/Xcode on first `flutter create`, `cdk init` refusing a non-empty dir, pnpm workspace glob mismatches, Node version drift vs. `.nvmrc`. | — |
| 5 | REFACTOR | `tdd-guide` | No file over 400 lines (trivially true), no duplicated config between root and package tsconfigs, no hardcoded account IDs or region strings — region/env must come from CDK context or env vars from the very first commit. | Checklist clean. |
| 6 | Domain review | `typescript-reviewer` | Reviews root/package `package.json`s, tsconfigs, `pnpm-workspace.yaml`, CDK bootstrap, `pr.yml`. **`flutter-reviewer` and `database-reviewer` skipped** — `mobile/` is unmodified `flutter create` output and there is no SQL yet. | Findings addressed. |
| 7 | Security | `security-reviewer` | **RUNS** — this touches CI config and repo secrets posture. Checks: no AWS account IDs / keys / ARNs committed; `.gitignore` covers `.env*`, `cdk.out/`, `*.pem`, `google-services.json`, `GoogleService-Info.plist`; `pr.yml` uses OIDC role assumption (not long-lived keys) if it touches AWS at all; workflow permissions least-privilege; repo is **private**. | No CRITICAL/HIGH open. |
| 8 | Doc move + sync | `doc-updater` | **(a)** `git mv` `PRD.md`, `SYSTEM_DESIGN.md`, `E2E_MVP_PLAN.md` into `docs/`, plus this file as `docs/DEV_WORKFLOW.md`. Fix all cross-doc relative links (SD front-matter links `./PRD.md` — still correct post-move, but verify). **(b)** Create `docs/RUNBOOK.md` stub (required by E2E §8 MVP DoD; stub now, fill in W22–W23). **(c)** File the **§0 amendment** to E2E §8 Coverage: Flutter ≥60% → ≥80%, and record the E2E-at-W16 proposal against §6 if you approve it. **(d)** Record current real-world state not yet in any doc: AWS dev+prod live under one Org (Paid Plan, per PRD §17.2a), sole-prop registration **in progress**, `parimaan.app` bought / `.in`+`.com` **pending**, socials + `parimaanapp@gmail.com` secured, AWS Activate **not yet applied** (blocked on Q11 registration). This makes the Phase 0 checklist honest about what's actually still open. | Docs consistent; no dangling links. |
| 9 | GitHub setup | *none* (main) | Create private repo. Push. Branch protection on `main`: require PR, require `pr.yml` to pass, no force-push, no deletion. **Do not require a second approving review** — solo dev; a self-approval requirement is theatre that will get disabled in week 2. | Protection rules verified; a direct push to `main` is rejected. |
| 10 | Commit | *none* (main) | Two commits: `chore: scaffold pnpm + flutter monorepo per system design §12.2` and `docs: move PRD, system design, E2E plan, and dev workflow into docs/`. Run security.md checklist before each. | Both green on CI. |

**Sprint 0 exit criteria** (subset of E2E §3 Phase 0 DoD — the rest is account/legal work tracked separately):
- [ ] Directory tree matches SD §12.2 exactly
- [ ] `pnpm -r install && pnpm -r typecheck` green; `flutter analyze` green; placeholder CDK test green
- [ ] `pr.yml` passes on a throwaway PR
- [ ] All 4 docs live in `docs/`; `RUNBOOK.md` stub created; §0 coverage amendment filed
- [ ] Repo private, `main` protected, direct push rejected
- [ ] No secrets, account IDs, or region literals committed

---

## 6. Risks specific to this workflow

### 6a. Full strict TDD on a 260-hour budget — **acknowledged, chosen, and not free**

You were offered the lighter option (strict TDD backend-only + widget/golden tests on UI) and chose full strict TDD everywhere. Recording the tradeoff so it stays a decision rather than becoming a surprise:

- Realistic overhead for strict RED-GREEN-REFACTOR at 80% is **+25–40% on implementation time**. Against ~232 hrs of Phase 1–6 build time, that's **~58–93 hours** — i.e. **6–9 weeks of your 10 hr/week runway**. The plan's total buffer (§7) is **20 hours**. The arithmetic does not close on its own.
- It lands hardest exactly where the plan is already **flagged as stretch**: Phase 1 (Flutter learning curve, already −30% velocity per PRD assumption #6, now also learning `flutter_test` + Riverpod testing simultaneously) and Phase 3 (densest business logic).
- The upside is real and worth naming: Phase 3's rotation/staples/deduction logic is precisely the kind of code where TDD pays for itself, and the RLS + authorization tests are genuine security value on a multi-tenant household model.

**Checkpoint — end of Phase 1 / W4, non-negotiable:**
Compare actual hours logged W1–W4 (from the §4.2 weekly `doc-updater` pass) against E2E §7's **~40 hr Phase 1 estimate**.

| Overrun | Action |
|---|---|
| ≤10% (≤44 hrs) | Continue unchanged. |
| 10–25% (44–50 hrs) | Continue, but re-check at W8 with the same rule. Two consecutive amber = treat as red. |
| **>25% (>50 hrs)** | **Stop and bring a scoped-down-TDD proposal back to you** — do not silently continue and do not silently drop tests. Proposal shape: keep strict TDD on `api/src/domain/`, all RLS/authorization, and Flutter domain+state layers; downgrade Flutter *widget* tests to smoke + component goldens only. Estimated recovery ~30–40 hrs. Your call, not mine. |

Secondary trigger, independent of hours: if W4 ends with **fewer than 15 of the 17 Phase 1 screens** landed, run the same conversation regardless of hours logged.

### 6b. Agent-orchestration overhead — **yes, there's a floor. Fast Lane defined.**

Ten agent invocations on a 20-minute change costs more wall-clock than the change. Minimum feature size for the full pipeline:

| Tier | Definition | Pipeline |
|---|---|---|
| **Fast Lane** | Single file, <30 min, no new logic, no new dependency, no security surface. (copy fix, spacing tweak, icon swap, log-message change, dependency patch bump) | Implement → run existing tests → commit. **Zero agents.** |
| **Standard** | 1–3 files, new logic, one domain. (a resolver, a screen, a widget) | Full pipeline, **domain reviewer + `code-reviewer` merged into one invocation** where only one domain is touched. |
| **Full** | Cross-package, new dependency, security surface, or a spike outcome. | Full pipeline, reviewers run in parallel. |

Additional overhead controls:
- **Batch reviews at the week boundary** where the week is one coherent slice (e.g. W4's 12 settings screens → one `flutter-reviewer` pass over all of them, not twelve).
- **Run step-6 reviewers in parallel** whenever more than one applies — they're independent.
- **`refactor-cleaner` runs on a schedule, not per feature** — once per phase (W4/W8/W12/W16/W20/W24). Dead-code sweeps have no per-feature signal.
- If agent overhead alone is visibly costing >1 hr/week, collapse Standard tier to `tdd-guide` + one merged reviewer and note it at the next phase boundary.

### 6c. Strict TDD vs. the 6 scheduled spikes — **spikes are explicitly exempt**

R1–R10 in E2E §6 are **exploratory by definition**: "does Bedrock have Claude in ap-south-1," "do 16/20 Indian blogs emit JSON-LD," "does Aurora resume in <30s." You cannot write a failing test for a question whose answer determines whether the feature exists at all. Forcing TDD onto spikes produces tests for code that gets deleted.

**Spike protocol (W3, W7 ×2, W11 ×2, W17, W23):**
1. Spike code lives on a `spike/*` branch and is **never merged to `main`**.
2. No tests required during the spike. Timebox stated up front (W7's are day-1 tasks; W17's is a full-day).
3. Output is a **written finding** committed to `docs/spikes/<id>-<name>.md` — the finding is the deliverable, not the code.
4. `doc-updater` records the outcome against the E2E §6 risk row (§4.1 trigger).
5. If the spike says "build it," the **real** implementation starts fresh in the full TDD pipeline. Spike code may be read for reference; it is not promoted.

Corollary risk: **W7 carries two spikes plus six screens plus the AI parser** — the single densest week in the plan. If the W4 checkpoint is amber, W7 is the first place to expect spill into the W25–W26 buffer.

### 6d. Other workflow risks from the source docs

| Risk | Why | Mitigation |
|---|---|---|
| **SDL drift across four consumers** | `shared/schema.graphql` feeds Ferry (Dart), graphql-codegen (TS), urql (web), and Zod validators. A hand-edit to any generated artifact breaks the contract silently. | `pr.yml` regenerates all clients and fails on a dirty git tree. `doc-updater` trigger on every SDL change (§4.1). |
| **RLS tested only via mocks** | SD §6.2 layer 3 is the "even if a resolver is buggy" backstop. Mocked `pg` clients cannot exercise it. A green suite would prove nothing. | Real Postgres in tests (§3.2). `database-reviewer` mandatory on every migration. Every RLS policy gets a wrong-household-user RED test — this is the W1–W4 DoD item "tested with a wrong-household user." |
| **Coverage measured, quality not** | 80% is reachable with assertion-free tests. | `code-reviewer` explicitly checks test *quality* — meaningful assertions, error paths, not just happy-path line-touching. |
| **Docs drift because doc updates feel optional** | Three locked docs, solo dev, tight budget — docs are the first thing to slip, and the §6a checkpoint depends entirely on the weekly log existing. | §4.2 weekly backstop is a **DoD item for every week**, not a nice-to-have. A week is not done until its E2E §4 row has actuals. |
| **Phase 0 has unfinished real-world blockers** | Sole-prop registration in progress (gates Q11 → AWS Activate → the $1,000 that PRD §17.2a calls "the real cost lever"); `.in`/`.com` unbought; Apple Dev enrollment (~1 wk, gates W20). | Step 8 of Sprint 0 records actual state in the docs. Track these as a Phase 0 open-items list, and **start Apple Dev enrollment now** — it's a W20 blocker with a one-week lead time and zero reason to wait. |

---

## 7. Definition of Done — reference, not redefinition

**DoD is owned by `E2E_MVP_PLAN.md` §8.** That document's per-milestone table (End of Month 1 → End of Month 6) and MVP-overall DoD (Functional / Performance / Quality metrics / Coverage / Ops / Distribution / Docs) are authoritative and unchanged by this plan, except for the single §0 coverage amendment filed in Sprint 0 step 8.

This workflow's per-feature gates are the **inputs** that make those milestone rows true:

```
  PER-FEATURE GATES (§2)                    ROLL UP INTO
  ─────────────────────────────────────     ─────────────────────────────────
  RED→GREEN→REFACTOR complete,          →   §8 Coverage: Lambda ≥80%,
  coverage ≥ target                         Flutter ≥80% (amended), CDK snapshots

  Domain reviewer approved              →   §8 Functional: scope shipped per PRD §7.1
  security-reviewer clean (§2.3)        →   §8 Ops + prod-readiness (W23 gate)
  code-reviewer clean                   →   §8 Quality metrics
  doc-updater synced (§4)               →   §8 Docs: PRD, SD, E2E plan, RUNBOOK in docs/
  Conventional commit + security        →   §3 phase Exit criteria (DoD)
  checklist run                             ↓
                                            §8 per-milestone DoD row
                                            ↓
                                            §8 MVP overall DoD
```

**Escalation rule:** a milestone row in §8 may only be marked done when **every** feature delivered in that phase cleared its per-feature gates. A phase-boundary `security-reviewer` sweep and `refactor-cleaner` pass (§6b) are prerequisites for declaring any milestone done. If a feature shipped with a gate waived, that waiver is recorded by `doc-updater` against the phase — no undocumented exceptions.

---

## Files referenced

- [`docs/PRD.md`](./PRD.md)
- [`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md)
- [`docs/E2E_MVP_PLAN.md`](./E2E_MVP_PLAN.md)
- This file lives at `docs/DEV_WORKFLOW.md` (moved here as part of Sprint 0 step 8).
