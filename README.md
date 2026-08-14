# Parimaan · परिमाण

**Parimaan** is a household-shared, mobile-first meal planning and pantry app built for Indian kitchens.

You plan the week's meals on your phone, the shopping list falls out automatically, and everyone in
the house sees the same pantry, plan, and list in real time. AI helps by reading a photo of your shelf
to update the pantry, suggesting recipes from what you already have, and turning free-form recipe notes
into structured recipes you can plan with.

The name — *parimaan* (परिमाण) — is Sanskrit/Hindi for **measure** or **quantity**, which is the whole
game: knowing what's in the kitchen, what needs to be cooked, and what still needs to be bought.

---

## Documentation

All planning and design documents live in [`docs/`](./docs). Read them in this order:

| Document | What it covers |
|---|---|
| [`docs/PRD.md`](./docs/PRD.md) | Product requirements — problem, users, scope, features, cost analysis |
| [`docs/SYSTEM_DESIGN.md`](./docs/SYSTEM_DESIGN.md) | Architecture, data model, GraphQL SDL, AWS topology, security model |
| [`docs/E2E_MVP_PLAN.md`](./docs/E2E_MVP_PLAN.md) | **LOCKED** — the 26-week build plan, 6 phases, 15 locked decisions, DoD |
| [`docs/DEV_WORKFLOW.md`](./docs/DEV_WORKFLOW.md) | The per-feature pipeline: research → plan → TDD → review → docs → commit |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) | Operational runbook — incidents, rollback, contacts |
| [`docs/spikes/`](./docs/spikes) | Written outcomes of the scheduled research spikes (R1–R10) |
| [`docs/archive/`](./docs/archive) | Superseded documents, kept for history |

`docs/E2E_MVP_PLAN.md` is authoritative on **what to build and when**.
`docs/DEV_WORKFLOW.md` is authoritative on **how work is executed**.

---

## Repository layout

```
mobile/    Flutter app (iOS + Android)   — standalone peer dir, plain `flutter` CLI
web/       Next.js dashboard (App Router)
api/       Lambda GraphQL resolvers (Node 20 + TypeScript)
shared/    GraphQL SDL (source of truth) + generated TS types + Zod schemas
infra/     AWS CDK v2 stacks
recipes/   Curated recipe seed JSON
docs/      Everything above
```

**`mobile/` is intentionally not a pnpm workspace** (locked decision Q13). The pnpm workspace covers
`web`, `api`, `shared`, and `infra` only; the Flutter app is driven by the `flutter` CLI directly.

---

## Getting started

### Prerequisites

- **Node 20** — `nvm use` (reads `.nvmrc`)
- **pnpm 10+** — `corepack enable && corepack prepare pnpm@latest --activate`
- **Flutter (stable)** — `flutter doctor` must be clean before touching `mobile/`
- **AWS CLI v2** with a configured profile, for anything in `infra/`

### TypeScript packages

```bash
nvm use
pnpm install          # installs web, api, shared, infra
pnpm check            # lint + typecheck + tests across all workspaces
```

Individual gates:

```bash
pnpm lint             # eslint across the repo
pnpm typecheck        # tsc --noEmit in every workspace
pnpm test             # vitest in every workspace
```

### Flutter app

The Flutter app is **not** part of the pnpm workspace. Run it directly:

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

Or from the repo root: `pnpm mobile:analyze`, `pnpm mobile:test`.

### Infrastructure

```bash
cd infra
pnpm test                                   # CDK assertions tests
pnpm cdk synth  -c env=dev                  # synthesize
pnpm cdk deploy -c env=dev                  # deploy (requires AWS credentials)
```

Target account and region are supplied via CDK context (`-c env=…`) and the standard
`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` environment variables. **No account ID or region
literal is ever committed to this repository.**

---

## Contributing

Solo project, but the process is not informal — see [`docs/DEV_WORKFLOW.md`](./docs/DEV_WORKFLOW.md).

- Strict TDD: tests are written and shown failing before implementation.
- All work goes through a pull request; `main` is protected and `pr.yml` must pass.
- Conventional commits: `<type>: <description>` where type ∈ feat, fix, refactor, docs, test, chore, perf, ci.
- Run the security checklist (no secrets, no account IDs, no region literals) before every commit.

---

## Status

**Phase 0 — Sprint 0.** Repository scaffolded; no application code yet.
Track progress against the week-by-week table in [`docs/E2E_MVP_PLAN.md`](./docs/E2E_MVP_PLAN.md) §4.

<!-- CI verification commit, will be squashed/closed -->
