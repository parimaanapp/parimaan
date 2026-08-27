# Parimaan — E2E MVP Implementation Plan

**Version:** 2.0 — LOCKED (all 15 open questions resolved; supersedes v1.0 and TIP v0.1)
**Owner:** Amogh Kulkarni
**Timeline:** 6 months, ~10 hrs/week, ~260 hrs total, solo dev
**Design system:** Parimaan — Haldi & Terracotta (30 components, tokens locked)
**Wireframes:** 49 mobile screens across 12 flows (v2)

**Phase 0 execution status (as of 2026-08-14):** AWS dev + prod accounts created and linked under one AWS Organization (both auto-upgraded to Paid Plan on linking — expected, see PRD §17.2a). Sole proprietorship registration **in progress**, not yet confirmed (blocks task: apply for AWS Activate credits, Q11). Domain `parimaan.app` bought; `.in` and `.com` **still pending**. Social handles `@parimaanapp` (Instagram, X) and `parimaanapp@gmail.com` secured. AWS Activate **not yet applied for**. Monorepo scaffold (Sprint 0) in progress — see `docs/DEV_WORKFLOW.md` §5. Homebrew + Flutter installation blocked on user's admin credentials (cannot be automated non-interactively); `mobile/` exists as a placeholder pending `flutter create`.

---

## 1. Requirements restatement

Parimaan is a household-shared meal planning, pantry, and shopping-list app for Indian kitchens, delivered as a Flutter mobile app (iOS + Android) with a light Next.js web dashboard, backed by an AWS serverless stack in `ap-south-1`. The MVP anchors on one core loop — plan the week, subtract pantry, generate a shopping list, share as image, mark items bought, deduct pantry when a recipe is marked made — and layers four narrow AI features on top: photo pantry helper, cook-from-pantry, freeform recipe parse, and staples check note. It ships with a hand-authored 50-recipe curated library (30 North + 20 South Indian), Google SSO only, household-scoped data with a 5-member cap, and push notifications.

Success is defined as: (a) the founder's own household using it daily by end of month 3, (b) 3+ external beta households using it weekly by end of month 6, (c) sync latency <5s across household members, and (d) AI acceptance rates hitting product-quality targets in PRD §11 (photo pantry ≥70%, freeform parse ≥80%, URL import ≥80%). Explicit non-goals: cart integrations, i18n, offline write, per-role permissions, ingredient normalization, nutrition tracking, subscription billing.

---

## 2. Workstreams

Ten parallel workstreams, each with an owner-lens and end-of-MVP DoD.

| # | Workstream | Scope (MVP) | Definition of Done at MVP |
|---|---|---|---|
| WS-1 | **Infrastructure / AWS (CDK)** | 6 CDK stacks in TS: network, auth, data, api, frontend, observability. Two accounts (dev + prod). ap-south-1. | `cdk deploy --all` succeeds in both accounts, prod stacks live before beta invites, cost <$35/mo |
| WS-2 | **Backend / API** | AppSync GraphQL SDL, ~28 Lambda resolvers (Node 20 TS), 3-layer auth (JWT + resolver membership check + Postgres RLS), Aurora Serverless v2 via RDS Proxy, DynamoDB cache + rate limits | All queries/mutations/subscriptions in §6.1 SDL implemented, tested, and instrumented; RLS policies on every household-scoped table |
| WS-3 | **Mobile / Flutter** | Flutter 3.x app, Riverpod, go_router, Ferry (GraphQL), Drift read-cache, `amplify_auth_cognito` for OAuth, `image_picker`, `share_plus`, FCM | All 49 wireframe screens shipped on iOS + Android; passes DoD in §7.4 of TIP for every feature; TestFlight + Play Console internal builds |
| WS-4 | **Web / Next.js** | App Router, NextAuth + Cognito, urql, read-only pantry / plan / list, edit for recipes + settings, hosted on Amplify Hosting | 4 screens live at `parimaan.app`: sign-in, dashboard (pantry + plan + list read), recipes CRUD, household settings |
| WS-5 | **Design System integration** | Translate CSS-token design system into Flutter theme, Phosphor icon set, Instrument Serif + DM Sans + JetBrains Mono + Noto Serif Devanagari (wordmark only). Build the 30 components + 5 domain widgets in Flutter. | `lib/shared/ui/` contains all 30 components + RecipeCard, PantryRow, MealSlot, ChecklistItem, AIProposal; visual QA against wireframes on both platforms |
| WS-6 | **Data / Content model** | Postgres DDL from SD §7.1, `node-pg-migrate` migrations, DynamoDB single table, S3 bucket layout, seed script for curated library | Migrations idempotent, RLS enabled, curated recipes copied on `createHousehold`, DDB TTL working |
| WS-7 | **AI / Bedrock** | 4 AI features: photo pantry (Sonnet vision), cook-from-pantry (Sonnet), freeform recipe parse (Haiku), staples note (Haiku). Cross-region fallback, cache, rate limits, cost alarms | All 4 features live; Zod schema validation on responses; per-user daily rate limits enforced; CloudWatch cost alarm at $5/day |
| WS-8 | **Ops / Observability** | CloudWatch structured logs, custom metrics, X-Ray traces, SNS→email alarms, PostHog client SDK + funnel events | 5 alarms live (Lambda 5xx, AppSync 5xx, Aurora CPU, Bedrock throttle, daily AI cost); PostHog funnel dashboard shows install→list_generated |
| WS-9 | **Content / Curated recipes** | Author 30 North Indian + 20 South Indian recipes as JSON in `recipes/` (title, ingredients w/ qty+unit, steps, role, cuisine tier1+tier2, dietary tags) | 50 recipes checked into repo, seeded on every new household, spot-checked against real cooking by founder |
| WS-10 | **Launch / Beta** | Apple Dev + Google Play enrollment, TestFlight internal + external, Play Console internal test, PostHog analytics live, feedback loop with 3–5 beta households | 3+ external households onboarded, first-week retention measured, backlog of P0 fixes triaged |

---

## 3. Phase-by-phase plan

Six phases mapped to the 26-week runway.

### Phase 0 — Prerequisites (Week 0, pre-work)
- **Goal:** every account, tool, and legal precaution done before Week 1.
- **Entry criteria:** PRD, System Design, and this plan approved.
- **Exit criteria (DoD):**
  - Two AWS accounts under Organizations; MFA everywhere.
  - Google Cloud OAuth client provisioned; Firebase project created.
  - Apple Developer enrollment submitted (takes ~1 week; parallel).
  - Google Play Developer paid.
  - Domains `parimaan.app` + `.in` + `.com` bought; socials grabbed.
  - AWS Activate ($1,000) application submitted.
  - IP India Class 9/30/42 free search run for "Parimaan" and results archived.
  - Monorepo scaffolded (pnpm workspaces + Flutter as peer module), pushed to GitHub with branch protection.
  - Design system tokens exported to `shared/design-tokens.json` (colors, spacing, radius, motion, elevation) — Flutter theme file drafted from these.
- **Wireframe screens delivered:** none.
- **Technical deliverables:** empty repo skeleton per SD §12.2, `.nvmrc`, `.gitignore`, GitHub Actions PR workflow, README.

### Phase 1 — Foundation (Weeks 1–4, Month 1)
- **Goal:** two-device Google SSO + household create/join/configure + empty tabs.
- **Entry criteria:** Phase 0 DoD met.
- **Exit criteria (DoD):**
  - `cdk deploy --all` succeeds to dev (network + auth + data + api + hello-world resolver).
  - Cognito Google SSO end-to-end on iOS + Android + web sign-in test page.
  - `createHousehold`, `joinHousehold`, `updateHouseholdSettings`, `me` mutations/queries live.
  - 5-member cap enforced server-side with test.
  - Household settings persist and sync across devices via `onHouseholdChanged` subscription.
  - Row-level security policies on every scoped table, tested with a wrong-household user.
  - Aurora auto-pause resume spike run (SD §15.2).
  - Flutter theme file matches design system tokens; 10 core components (Button, IconButton, Input, Card, TopBar, TabBar, Chip, Badge, EmptyState, Toast) implemented.
- **Wireframe screens delivered (17):** Flow 1 (Splash, Sign in, First run choose path, Notifications prompt), Flow 2 (Name household, Meals to plan, Meal structure lunch, Cuisine regions, Cuisine sub+bias, Dietary+allergens, Invite code), Flow 3 (Enter code, Confirm, Full·notify primary), Flow 4 (Settings hub, Members list, Notif preferences [scaffold]).
- **Technical deliverables:** all Month-1 CDK stacks (SD §16), `001-baseline.sql` migration, Ferry codegen wired, Riverpod `currentHousehold` provider, `go_router` route table.

### Phase 2 — Core Data + Sync (Weeks 5–8, Month 2)
- **Goal:** pantry + recipes CRUD, URL import, freeform AI parse, real-time sync.
- **Entry criteria:** Phase 1 DoD met.
- **Exit criteria (DoD):**
  - Pantry: add/edit/delete, categories, staples flag, low-threshold; Drift local read-cache hydrates offline.
  - Recipes: structured entry, URL import (JSON-LD parser + graceful failure), freeform AI parse via Bedrock Haiku with confirm screen.
  - `onPantryChanged` subscription fanout across 2 devices, <5s sync verified.
  - Bedrock ap-south-1 availability spike done (SD §15.1); fallback path documented.
  - JSON-LD coverage spike done on top-20 Indian recipe blogs (target ≥16/20).
  - Domain widgets built: PantryRow, RecipeCard, AIProposal.
- **Wireframe screens delivered (12):** Flow 7 (Library, Detail, Overflow menu), Flow 8 (Choose method, Structured form, URL import, Freeform input, Freeform review), Flow 9 (List, Add choose method, Manual add), Flow 12 (AI failure fallback).
- **Technical deliverables:** Pantry + Recipe resolvers, `parseFreeformRecipe` + `importRecipeFromUrl`, DynamoDB rate-limit counter (skeleton), Zod schemas for AI outputs.

### Phase 3 — Core Loop: Plan + List (Weeks 9–12, Month 3)
- **Goal:** the Sunday-evening loop from PRD §6 works end-to-end for the founder's household.
- **Entry criteria:** Phase 2 DoD met.
- **Exit criteria (DoD):**
  - 7-day calendar honoring meal structure config; picker filtered by role; favorites + rotation surfaced first.
  - `autoFillWeek` + `regenerateWeek` (with confirmation) respecting MAX caps and recency avoidance.
  - Shopping list auto-generation: sum across recipes, subtract pantry, exclude staples (tsp/tbsp/is_staple/spice-oil-salt categories).
  - "Have it" swipe → quantity prompt → moves item to pantry, drops off list.
  - "Mark as made" deducts pantry (best-effort match by ingredient name lowercase).
  - `onMenuChanged` + `onShoppingListChanged` subscription tests with 2 devices.
  - AppSync subscription throughput spike with 5 concurrent clients (SD §15.3).
  - RDS Proxy concurrent-load spike (TIP §9).
  - Domain widget: MealSlot, ChecklistItem.
- **Wireframe screens delivered (14):** Flow 5 (Today morning, Today empty), Flow 6 (Weekly plan, Picker sheet, Auto-fill preview, Week confirmed→list prompt, List preview, Regenerate confirm, Mark as made), Flow 10 (List, Swipe · Have it, Have-it quantity, Bought syncs to pantry), Flow 12 (Offline banner).
- **Technical deliverables:** menu + shopping list resolvers, `haveIt` transaction, `markMade` pantry-deduction resolver, subscription authorizer Lambda.

### Phase 4 — Content + Web + Share (Weeks 13–16, Month 4)
- **Goal:** curated library seeded on every new household; share-as-image; read-only web dashboard.
- **Entry criteria:** Phase 3 DoD met; founder household using it daily.
- **Exit criteria (DoD):**
  - 50 curated recipes JSON authored, validated, seeded via one-off Lambda on `createHousehold`.
  - Shopping list share-as-image: Flutter renders categorized image client-side (SD §17 open Q #3), invokes native share sheet with `share_plus`.
  - AI staples note (Haiku) appended to shopping list; 24-hr cache per list.
  - Next.js web dashboard: sign-in + read views for pantry / plan / list + edit for recipes + settings admin.
  - Amplify Hosting deployed with `dev.parimaan.app` domain.
- **Wireframe screens delivered (1):** Flow 10 (Share image preview). Web = 4 additional web-only screens (not in the 49 mobile count, but delivered).
- **Technical deliverables:** `exportShoppingListImage` mutation (returns presigned S3 URL for backup/history), curated seeder Lambda, frontend-stack CDK, urql client wiring in web.

### Phase 5 — AI at scale + Push (Weeks 17–20, Month 5)
- **Goal:** all 4 AI features live and rate-limited; push notifications delivered on iOS + Android.
- **Entry criteria:** Phase 4 DoD met.
- **Exit criteria (DoD):**
  - Bedrock vision spike done first day; go/no-go on photo pantry documented.
  - Photo pantry: client compresses 1024px q80, presigned upload, Sonnet vision, `AIProposal` review UX with per-item accept/edit/reject.
  - Cook-from-pantry: `cookFromPantry(vibe)` returns 3 grounded recipes with missing-list; save adds to library with role auto-assigned.
  - FCM push notifications: shopping list changes, today's meal, expiry (Lambda cron), household activity.
  - Notification preferences per user per household (`notification_preferences` table).
  - Per-user daily AI rate limits enforced (DDB counter) for all 4 features.
  - Cost alarm at $5/day active.
  - Apple Dev enrollment complete; Play Console configured.
- **Wireframe screens delivered (5):** Flow 9 (Photo AI review), Flow 11 (Trigger, Suggestions, Suggestion detail), Flow 12 (Push notifications).
- **Technical deliverables:** `analyzePantryPhoto`, `cookFromPantry`, `parseFreeformRecipe` upgraded to caching, FCM Lambda + APNs certs, expiry-cron EventBridge rule.

### Phase 6 — Polish + Beta (Weeks 21–24, Month 6, with Weeks 25–26 buffer)
- **Goal:** MVP ships; 3+ external households on TestFlight/Play internal.
- **Entry criteria:** Phase 5 DoD met.
- **Exit criteria (DoD):**
  - Onboarding walkthrough polished; every empty state has copy + illustration.
  - Offline read-cache invalidation tested (spike: what happens when user comes back online after 24h?).
  - PostHog SDK on Flutter + Web; funnel dashboard built; session replay enabled.
  - Prod stacks deployed via `deploy-prod.yml` (manual approval gate).
  - TestFlight external + Play Console internal builds live.
  - 3–5 external households onboarded, week-1 retention measured.
  - P0 beta bugs triaged and fixed.
  - Cost tracker shows <$35/mo run rate.
- **Wireframe screens delivered:** all 49 mobile screens polished (final visual QA pass).
- **Technical deliverables:** observability-stack (alarms, dashboards), PostHog integration, prod deployment run, TestFlight/Play submissions.

---

## 4. Week-by-week sprint schedule (all 49 wireframe screens mapped)

| Week | Focus | Wireframe screens landed (running count) | Backend / infra deliverables | DoD gate |
|---|---|---|---|---|
| **W0** | Prerequisites | none (0/49) | Accounts opened, monorepo bootstrapped, design tokens exported | Phase 0 DoD |
| **W1** | AWS foundation + Cognito | none (0/49) | network-stack + auth-stack deployed to dev; Google IdP verified in Hosted UI | Cognito browser test passes |
| **W2** | Flutter scaffold + SSO E2E | Splash, Sign in (2/49) | Flutter app boots; `amplify_auth_cognito`; deep links (`parimaan://`) working iOS + Android | Sign-in + sign-out on both platforms |
| **W3** | Data stack + first mutation | First run choose path (3/49) | data-stack; RDS Proxy; `001-baseline.sql` migration; `createHousehold` resolver; RLS baseline | Row in `households` after tap in Flutter |
| **W4** | Household create + settings screens | Name household, Meals to plan, Meal structure lunch, Cuisine regions, Cuisine sub+bias, Dietary+allergens, Invite code, Enter code, Confirm, Full·notify primary, Settings hub, Members list (15/49) | `joinHousehold` w/ 5-cap; `updateHouseholdSettings`; `me` query; `onHouseholdChanged` sub; 10 core UI components | Two-device demo: create + join + settings sync; **End of Month 1 milestone** |
| **W5** | Pantry CRUD + Drift cache | Pantry List, Add choose method, Manual add (18/49) | pantry resolvers; `onPantryChanged` sub; Drift local schema; PantryRow widget | Two-device pantry edit <5s sync |
| **W6** | Structured recipes + roles (locked as a **two-week** sprint, §12.5.1/D8 — same pattern as W5) | Recipes Library, Detail, Overflow menu, **Structured form** (pulled forward from W7 per §12.7 D2) (22/49) | recipe resolvers (createRecipe/updateRecipe/deleteRecipe/favoriteRecipe/setInRotation); `role` enum (meal-slot, required, no default — §12.7 D1); `onRecipeChanged` sub (pulled forward from W8 per §12.7 D6); RecipeCard widget | Recipe CRUD complete (server + mobile); role assignment required; two-device recipe sync <5s (RUNBOOK.md §3, re-run per §12.7 D6) |
| **W7** | URL import + freeform AI parse **spike week** | Choose method, URL import, Freeform input, Freeform review, AI failure fallback (27/49) | JSON-LD parser; `parseFreeformRecipe` via Haiku; Zod validation; **Bedrock ap-south-1 spike**; **JSON-LD spike (top-20 blogs)**; AIProposal widget | ≥16/20 blogs parse; freeform AI returns valid JSON |
| **W8** | Sync polish + Month 2 demo | Notif preferences (finalized) (28/49) | Reconnect backoff; refetch-on-reconnect; membership caching (30s TTL) | **End of Month 2 milestone:** 2-device sync <5s under load |
| **W9** | 7-day calendar UI | Weekly plan, Today morning, Today empty (31/49) | `createMenu`, `addMenuItem`, `removeMenuItem` resolvers; MealSlot widget; today's-agenda query | Week-view honors meal structure config |
| **W10** | Recipe picker + rotation | Picker sheet, Auto-fill preview, Regenerate confirm (34/49) | `autoFillWeek(overwrite)` with recency avoidance + cuisine bias; **consumes** `setInRotation` (mutation itself ships W6, §12.7 D2 planning notes/§12.2.16) | Auto-fill respects MAX caps; regenerate requires confirm |
| **W11** | Shopping list + Have-it | Week confirmed→list prompt, List preview, Shopping List, Swipe · Have it, Have-it quantity (39/49) | `generateShoppingList`; staples exclusion logic; `haveIt` transaction; ChecklistItem widget; **RDS Proxy load spike**; **AppSync 5-client subscription spike** | List generated correctly; Have-it moves to pantry |
| **W12** | Mark-made + pantry deduction | Mark as made, Bought syncs to pantry, Offline banner (42/49) | `markMade` deducts pantry; `markPurchased` → pantry sync via subscription; offline detection banner | **End of Month 3 milestone:** full core loop; founder household using daily |
| **W13** | Curated library authoring | (42/49 — content-heavy week) | 30 North Indian recipes JSON authored + validated against schema | 30 recipes checked in |
| **W14** | Library complete + seeding | (42/49) | 20 South Indian recipes; curated seeder Lambda on `createHousehold`; test new-household flow | 50 recipes seed into a fresh household |
| **W15** | Share-as-image + AI staples note | Share image preview (43/49) | Flutter client-side image render (categorized layout); `exportShoppingListImage` for history; AI staples note via Haiku (24-hr cache) | Share sheet works to WhatsApp/Swiggy/Blinkit |
| **W16** | Web dashboard read + Month 4 demo | (43/49; +4 web screens off-count) | Next.js sign-in, dashboard (pantry/plan/list read), recipes edit, settings admin; Amplify Hosting; frontend-stack CDK | **End of Month 4 milestone:** curated library + share + web read live |
| **W17** | Bedrock vision spike + AI infra **spike week** | (43/49) | **Vision accuracy spike on 20 pantry photos**; Bedrock IAM; DDB rate-limit table; per-user counter | ≥60% acceptance on spike photos, else replan feature |
| **W18** | Photo pantry AI | Photo AI review (44/49) | `getPantryPhotoUploadUrl`; `analyzePantryPhoto` (Sonnet vision); client image compression (1024px q80); `bulkAddPantryItems` | Confirm-before-write flow; server-side reject >500KB |
| **W19** | Cook-from-pantry | Cook Trigger, Suggestions, Suggestion detail (47/49) | `cookFromPantry(vibe)` with 30-min cache per (household, pantryHash); save-to-library flow | Suggestions grounded in current pantry with highlighted matches |
| **W20** | Push notifications + Apple/Play setup | Push notifications (48/49) | FCM Lambda; APNs certs; EventBridge cron for expiry; `notification_preferences` reads on send; Apple Dev finalized; Play Console configured | Push received on both platforms; prefs toggle works |
| **W21** | Onboarding + empty states polish | (48/49 — final polish across all delivered screens) | Notifications permission prompt polished; every empty state has copy + illustration; error-state audit | All 48 screens pass visual QA |
| **W22** | PostHog + analytics | Notifications prompt polish (49/49 — all screens landed) | PostHog SDK on Flutter + Web; funnel events per SD §11.4; session replay opt-in; observability-stack CDK (alarms, dashboards) | Funnel visible in PostHog; 5 CloudWatch alarms armed |
| **W23** | Prod deploy + TestFlight/Play submit | (49/49 polish continues) | `deploy-prod.yml` runs; prod stacks live; TestFlight internal + Play Console internal builds submitted; **offline read-cache invalidation spike** | Prod deploy succeeds; both stores accept build |
| **W24** | Beta invite + bugs | (49/49) | 3–5 external households onboarded; feedback intake; P0 bug fixes | **End of Month 6 = MVP shipped:** 3+ external households on beta |
| **W25** | Buffer + P0/P1 fixes | (49/49) | Absorb any slippage from W1–W24 | Backlog clean of P0s |
| **W26** | Buffer + retro + v1.1 kickoff | (49/49) | Retro doc, v1.1 backlog groomed, cost tracker audit, credit runway calc | Ship + reset for v1.1 |

**Verification:** all 49 mobile wireframe screens are mapped. Sum by flow: Flow 1 = 4 (W2, W4, W22), Flow 2 = 7 (W4), Flow 3 = 3 (W4), Flow 4 = 3 (W4, W8), Flow 5 = 2 (W9), Flow 6 = 7 (W9, W10, W11, W12), Flow 7 = 3 (W6), Flow 8 = 5 (W7), Flow 9 = 4 (W5, W18), Flow 10 = 5 (W11, W12, W15), Flow 11 = 3 (W19), Flow 12 = 3 (W7, W12, W20) = **49 total, all accounted for**.

**Detailed plan for W5:** see §11 for the full slice breakdown, conflicts/gaps found in the locked docs, sequencing, risks, and exit criteria — the first week-level plan written before implementation, and folded directly into this document rather than a separate file, per the standing convention locked in §11.7.

---

## 5. Dependencies

### External accounts (open in W0 unless noted)

| Dependency | When | Blocking? | Notes |
|---|---|---|---|
| AWS dev account | W0 | Yes | MFA + IAM admin user |
| AWS prod account | W0 | No, but do it | Under Organizations from day 1 |
| AWS Activate application ($1,000) | W0 | No | Submit ASAP; approval 1–2 wks; covers ~4–5 yrs at beta scale |
| Google Cloud OAuth client | W0 | Yes for W1 | Decide which Google account owns it (see Open Q) |
| Firebase project (FCM) | W0 or W19 | Yes for W20 | Free |
| PostHog account | W22 | No | Free tier; **decide EU vs US region — India residency implication** |
| Apple Developer | W0 (submit) | Yes for W20 | ~1 wk to enroll; use `parimaan@` alias, not personal |
| Google Play Developer | W0 | Yes for W20 | $25 one-time, instant |
| Namecheap (`parimaan.app` + `.in` + `.com`) | W0 | No | ~$25/yr; brand protection |
| GitHub (private repos) | W0 | Yes | Branch protection on `main` |

### Internal / build-time dependencies

- **Design system → Flutter theme translation** (W1). Blocking for all UI work. Deliverable: `lib/shared/ui/theme.dart` + component library reaching feature-parity with the 30 CSS components by W8.
- **Phosphor Regular icon font** bundled in Flutter assets (W1).
- **Fonts:** Instrument Serif, DM Sans, JetBrains Mono, Noto Serif Devanagari — licensed check + embedded in `assets/fonts/` (W1).
- **Curated recipe authoring (WS-9)** is a 2-week content block in W13–W14 — must be scheduled as writing time, not code time. Founder authors + one round of edits.
- **JSON-LD Recipe schema coverage on Indian blogs** must clear the W7 spike or the URL import UX changes (fallback to freeform paste).
- **Bedrock model availability in ap-south-1** must clear the W7 spike or the AI-features Lambdas need cross-region config from day one.
- **Aurora auto-pause behavior** must clear the W3 spike or the plan swaps to on-demand `db.t4g.small` (~$27/mo flat).

---

## 6. Risks

Original 6 spikes from TIP §9, plus 4 new spikes surfaced by the design system + wireframes context.

| # | Risk | Category | Mitigation | Scheduled spike / checkpoint |
|---|---|---|---|---|
| R1 | Bedrock Claude unavailable in `ap-south-1` | Technical | Cross-region fallback to `us-east-1`; accept +150–250ms latency | **W7** (day 1) |
| R2 | JSON-LD Recipe schema coverage < 60% on Indian blogs | Technical | Copy-paste fallback UX in URL import screen; downgrade importance | **W7** (target ≥16/20) |
| R3 | AppSync subscription with 5 concurrent clients drops events | Technical | Reduce to per-entity subscriptions; add refetch-on-reconnect | **W11** (30-min soak, 5 clients) |
| R4 | Aurora Serverless v2 auto-pause resume >30s | Technical | Disable auto-pause (+$35/mo) or switch to `db.t4g.small` | **W3** (15-min idle, first-query timing) |
| R5 | Bedrock vision accuracy <60% on Indian pantry | Technical | Restrict feature to labeled/packaged items OR cut from MVP scaffold kept | **W17** (20 real photos) |
| R6 | RDS Proxy connection exhaustion under Lambda concurrency | Technical | Data API fallback; batch resolvers | **W11** (20 concurrent Lambdas) |
| R7 | **Flutter perf with 280-recipe library (50 curated + user + curated seed × N)** | Technical (new) | Paginated list; `flutter_lazy_indexed_stack`; recycled item widgets; benchmark on low-end Android | **W6 spike:** benchmark 300-item list scroll on a Redmi-class device |
| R8 | **Image compression pipeline (client) drops quality unpredictably** | Technical (new) | Fix to `image` package pipeline; benchmark on 30 photos; server rejects >500KB | **W17** as part of vision spike |
| R9 | **Offline read-cache invalidation causes stale display after 24h absence** | Technical (new) | Cache-first + background refetch; invalidate per-household on foreground; TTL 24h | **W23 spike:** stale-then-refresh testing |
| R10 | **Design system font licensing (Noto Serif Devanagari / Instrument Serif)** | Legal | Confirm SIL Open Font License; embed with attribution in About screen | **W1** (30-min check) |
| R11 | 5-member cap frustrates joint families | Product | Onboarding flag; v1.1 raises cap; document | Ongoing beta feedback |
| R12 | Users compare unfavorably vs AnyList/Paprika polish | Product | Beta invite copy sets expectations; focus DoD on core-loop excellence | W24 beta framing |
| R13 | Household-level pricing sets low revenue ceiling | Business | Post-MVP: cap AI features in free tier | Post-MVP (v1.1) |
| R14 | AI costs blow past $5/day alarm at beta | Business | CloudWatch alarm at $5/day; per-user daily rate limits; Haiku for text | Continuous from W17 |
| R16 | **No E2E test strategy existed in any locked doc** (surfaced during `DEV_WORKFLOW.md` planning — the SD §7.3 citation this plan was drafted against turned out not to exist) | Technical (new, 2026-08-14) | Proposed and adopted: Detox (mobile, 3 flows) + Playwright (web, 1 flow), introduced at **W16** (not month-4 start) since the core loop only stabilizes at W12 and W13–14 are content weeks. Run nightly + pre-release, not per-PR. Written after each flow is manually verified working, not TDD-first (selector churn against an unbuilt UI produces no design pressure). | **W16** (`e2e-runner` owns authoring + CI wiring) |
| R15 | Solo dev burnout at 10 hr/wk × 26 wk | Delivery | Slide the plan; take full weeks off; don't compress | Ongoing — check monthly |

---

## 7. Complexity + effort estimates

Total budget: **~260 hrs** (10 hr/wk × 26 wk).

| Phase | Weeks | Hours | Complexity | Notes |
|---|---|---|---|---|
| Phase 0 (Prereq) | W0 | ~8 | L | Account setup, no code |
| Phase 1 (Foundation) | W1–W4 | ~40 | **H** | CDK + Cognito + Flutter theme + 17 screens; **stretch** — Flutter learning curve slows this ~30% |
| Phase 2 (Core Data + Sync) | W5–W8 | ~40 | M-H | Two AI spikes in W7, subscription reliability |
| Phase 3 (Core Loop) | W9–W12 | ~40 | **H** | Rotation logic + shopping list generation + pantry deduction; most business logic here; **stretch** if W7 spikes require rework |
| Phase 4 (Content + Web + Share) | W13–W16 | ~40 | M | W13–W14 content-heavy not code-heavy; Web dashboard is smaller than mobile |
| Phase 5 (AI + Push) | W17–W20 | ~40 | M-H | Vision spike could invalidate photo pantry; push notifications iOS is fiddly |
| Phase 6 (Polish + Beta) | W21–W24 | ~40 | M | Feedback-driven; scope tight |
| Buffer | W25–W26 | ~20 | L | Absorbs slippage — **assume at least one phase spills into buffer** |

**Stretch phases flagged:** Phase 1 (Flutter learning), Phase 3 (business logic depth), Phase 5 (vision accuracy risk). If any one of these overruns by 2+ weeks, the plan slides — do NOT compress the next phase.

---

## 8. Definition of Done

### Per-milestone DoD

| Milestone | DoD (measurable) |
|---|---|
| **End of Month 1** | (a) Cognito Google SSO on iOS + Android + web sign-in test; (b) Household create/join with 5-cap enforced; (c) All 4 settings screens (meals, structure, cuisine, dietary) persist and sync via subscription; (d) 15 wireframe screens shipped; (e) `cdk deploy --all` succeeds on dev; (f) Aurora auto-pause spike passed |
| **End of Month 2** | (a) Pantry + recipe CRUD complete; (b) URL import success ≥80% on top-20 Indian blogs (or fallback shipped); (c) Freeform AI parse: ≥80% accepted with ≤3 edits (measured on 20 test parses); (d) 2-device sync <5s under load; (e) 28 wireframe screens shipped |
| **End of Month 3** | (a) Full core loop working: plan → auto-fill → generate list → have-it/mark-purchased → pantry updates; (b) Founder household uses it for one full week; (c) 42 wireframe screens shipped; (d) RDS Proxy + subscription spikes passed |
| **End of Month 4** | (a) 50 curated recipes seeded on new households; (b) Share-as-image works to WhatsApp/Swiggy/Blinkit; (c) AI staples note appended to list; (d) Web dashboard read+edit live at dev URL; (e) 43 mobile + 4 web screens shipped |
| **End of Month 5** | (a) Photo pantry ≥70% items accepted without edit on 20 test photos; (b) Cook-from-pantry live with 3-recipe response grounded in pantry; (c) Push notifications delivered on iOS + Android for all 4 event types; (d) Per-user AI rate limits active; (e) 48 wireframe screens shipped |
| **End of Month 6 (MVP)** | (a) All 49 mobile wireframe screens shipped and polished; (b) Prod stacks deployed; (c) TestFlight + Play Console internal builds live; (d) 3+ external households onboarded; (e) PostHog funnel dashboard shows install → list_generated; (f) Cost run rate <$35/mo; (g) All 5 CloudWatch alarms armed; (h) No P0 bugs open |

### MVP overall DoD (must hit all)

- **Functional:** all MVP scope in PRD §7.1 shipped; all 4 AI features in §7.2 shipped with confirm-before-write.
- **Performance:** 2-device sync latency <5s at P95; app cold-start <3s on mid-tier Android; photo upload success >95%.
- **Quality metrics:** photo pantry ≥70% acceptance; freeform parse ≥80% acceptance with ≤3 edits; URL import ≥80% success on top-20 blogs.
- **Coverage:** Lambda domain-logic tests ≥80%; Flutter state-layer tests **≥80%** (amended 2026-08-14 — see §0 note below); CDK snapshot tests present.

> **§0 amendment (2026-08-14, filed during Sprint 0):** the Flutter coverage target above was raised from the original ≥60% to ≥80% to match `DEV_WORKFLOW.md`'s locked decision #3 (full strict TDD everywhere — chosen explicitly over the lighter backend-only option). This is a real tradeoff against the tight 260-hour budget, tracked via the Phase 1/W4 checkpoint in `DEV_WORKFLOW.md` §6a. See `DEV_WORKFLOW.md` §0 for the full amendment rationale and §3.3 for how the ≥80% target is kept affordable (push logic out of widgets into domain/state layers; golden tests only on the 30 shared design-system components, not per-screen).
- **Ops:** 5 CloudWatch alarms armed; PostHog funnel live; cost tracker shows <$35/mo.
- **Distribution:** 3+ external beta households on TestFlight + Play internal.
- **Docs:** PRD, System Design, this plan, and a `RUNBOOK.md` for incident response, all in `docs/`.

---

## 9. Explicit non-goals for MVP

| Out of scope | Target version | Rationale |
|---|---|---|
| Household roles beyond primary/member (viewer, admin) | v1.1 | Trust model in MVP: all members full-edit |
| Primary-user transfer | v1.1 | Protects future subscription owner; "delete household" as escape hatch (open Q #4 lean: yes) |
| Ingredient normalization (canonical `ingredients` table + aliases) | v1.1 | Substring match good enough for MVP allergen warnings |
| Receipt OCR (AWS Textract) | v1.1 | Photo pantry covers the batch-entry job |
| Full AI recipe generator (open-ended) | v1.1 | Cook-from-pantry is the constrained version |
| Web parity with mobile (meal plan editing) | v1.1 | Read-only + recipes + settings only in MVP web |
| iOS/Android home-screen widgets | v1.1 | Post-beta polish |
| Cooking mode (step-by-step, screen-on) | v1.1 | Not core to Sunday-planning loop |
| Barcode scan for packaged items | v1.1 | Photo pantry covers this |
| Subscription billing (Stripe/Razorpay) | v1.1 | MVP is free; data model already carries `subscription_status` etc. |
| Nutrition macros | v1.2 | Indian nutrition DB is bottleneck |
| Meal-plan templates ("festival week") | v1.2 | Rotation covers steady state |
| Recipe scaling (double, halve) | v1.2 | Manual override on servings works |
| Min-required slot rules (must-have 1 carb) | v1.2 | MAX caps are enough |
| Multi-language UI (Hindi, Marathi, Tamil, Kannada) | v1.2 | Design string layer with `intl` from day 1; ship strings post-MVP |
| Cross-household recipe sharing / deep links | v1.2 | Household-shared covers the primary need |
| Offline write-and-sync | v1.1 | Read-cache only in MVP (cheapest to build) |
| Social feed / discovery | Never (unless proven) | Explicitly anti-goal |
| Restaurant / dine-out logging | Never | Anti-goal |
| Diet coaching, weight-loss features | Never | Anti-goal |
| Full nutrition tracking with goals | Never | Anti-goal |
| Direct cart integrations (Swiggy Instamart, Blinkit, Zepto, Amazon Fresh) | Never (until public APIs exist) | No public APIs; share-as-image is the compromise |

---

## 10. Locked decisions (formerly open questions)

All 15 decisions below are final. This plan is locked and ready for W0 to begin.

| # | Question | **Locked decision** | Detail / rationale |
|---|---|---|---|
| Q1 | RDS Proxy vs. Data API vs. direct connection? | **Direct connections first, no RDS Proxy upfront.** | W3 and W11 spikes test 20–30 concurrent Lambda invocations against real Aurora `max_connections` (roughly 90 at 0.5 ACU, up to ~300–350 at 2 ACU — approximate, verify against actual metrics). Direct connections don't degrade gracefully to "slow" — they cliff into hard connection-refused errors past the limit. At beta scale (20 users) sustained load is very unlikely to hit that ceiling; the real risk is a burst (push notification triggering many simultaneous subscription reconnects). Add RDS Proxy (+~$18/mo) only if the spike shows failures — don't pay for it speculatively. |
| Q2 | Amplify auth library on Flutter — yes/no? | **`amplify_auth_cognito` only; everything else hand-rolled.** | Hand-rolling OAuth PKCE + redirect handling + token refresh in Flutter is a realistic 1–2 week detour (redirect URI handling differs between iOS/Android, token refresh races, secure storage integration). Amplify's auth-only usage costs ~2–4MB bundle size (~8–15% of an estimated 20–30MB baseline app — not decision-driving) and some risk of lagging new Xcode/iOS releases. Fallback: `flutter_appauth` (thin wrapper over native AppAuth libraries) if Amplify's lag risk ever actually bites. |
| Q3 | Prod AWS account — provision W0 or later? | **Both accounts (dev + prod) provisioned in W0**, under one AWS Organization. Reconsidered twice (single-account-with-Lightsail and single-account-with-IAM-boundaries were both evaluated and rejected) before relocking here. | Direct AWS cost of 2 accounts vs 1 is **$0** either way — cost is driven by resource usage, not account count. Account-level separation was chosen over single-account + IAM permission boundaries because: (a) **service quotas are account-level and shared** within one account — Lambda concurrency, Bedrock RPM, AppSync throttle limits — so a dev-side load test or bug could starve prod's headroom; two accounts give independent quota pools; (b) IAM boundary policies are a *policy* boundary that can have bugs, vs. an account boundary which is structural and can't be misconfigured into a breach; (c) billing separation is unambiguous by construction, no tagging discipline required. **Lightsail was considered and rejected** as a way to "separate" dev/prod — it's a simplified VPS product that doesn't host any of our actual services (AppSync, Lambda, Aurora Serverless, Cognito, Bedrock, DynamoDB are all managed services independent of any VM); using it would mean abandoning the serverless architecture in System Design v0.1, not separating it. **Sequencing gotcha (verified):** AWS Free Tier is pooled/aggregated across an Organization, not doubled per account — no free-tier advantage to 2 accounts. Separately, promotional/free-tier credits that land on an account *before* it joins an Organization have been reported to expire immediately, with no warning, upon joining. Mitigation: **form the AWS Organization immediately after creating both accounts, before either account accrues any credit**, then apply for AWS Activate afterward — Activate credits are confirmed to apply correctly to the consolidated bill and can be shared across linked accounts via billing preferences once the Org exists first. |
| Q4 | Which Google account owns the OAuth client? | **New dedicated `parimaan@` Gmail/Workspace account**, not personal. | Decouples production auth infrastructure from personal Google identity lifecycle; cleaner for eventual OAuth consent-screen verification. |
| Q5 | PostHog region — EU vs US? | **EU Cloud** (`eu.i.posthog.com`), with a **DPA requested at account creation** (W22). | EU Cloud data sits in AWS `eu-central-1` (Germany) — verified via PostHog's own subprocessors page. Not an India-residency guarantee (no India region exists among mainstream product-analytics SaaS), and cross-region transfers rely on SCCs, not a hard EU-only guarantee. DPA must be actively requested, not automatic from region choice. **Self-hosting PostHog in `ap-south-1`** is deferred to v1.1+, only if India's DPDP Act rules (still being finalized) require in-country storage — self-hosting adds real ops surface (ClickHouse/Kafka/Postgres/Redis) not worth taking on speculatively. |
| Q6 | i18n string layer from day 1 — yes/no? | **Yes.** `flutter_intl`/ARB files scaffolded in W2; English-only strings shipped for MVP. | Retrofitting i18n later means finding and extracting hardcoded strings across all 49 screens — expensive, mechanical, low near-term value. Cheap to route all copy through a lookup layer from the first screen built. **Exception: the wordmark (परिमाण, Noto Serif Devanagari) stays hardcoded** — it's brand, not translatable UI copy. |
| Q7 | Amplify Hosting vs. Vercel for web dashboard? | **Amplify Hosting.** | Keeps the entire deployment story inside one AWS account / one CDK pipeline. Also cheaper in practice: Vercel's free Hobby tier contractually forbids commercial use (confirmed via Vercel ToS) — since Parimaan is explicitly heading toward monetization, Vercel would require Pro at $20/seat/month from day one. Amplify Hosting's free tier (1,000 build-min/mo, 5GB storage, 15GB transfer, 500K SSR requests/mo) comfortably covers the 4-screen MVP web dashboard; beyond that, costs stay in the $0–1/mo range already modeled in System Design §17.2. |
| Q8 | Curated library seeding — copy-per-household or shared table? | **Copy rows on `createHousehold`.** | 50 recipes × modest household counts keeps storage cost trivial at MVP/beta scale. Copying avoids an entire class of shared-mutable-state bugs, since favoriting/rotation-toggling/editing curated recipes are all explicit per-household MVP features. |
| Q9 | Beta testers for the core-loop milestone (W12)? | **Friends with low-stakes tolerance for bugs**, not necessarily immediate family. | Real multi-person usage is the actual point (shared pantry/plan/list sync bugs only surface with genuine concurrent use) — solo dry-runs test the wrong thing. Low-stakes testers reduce the cost of a mid-week failure during an admittedly unfinished app. |
| Q10 | "Delete household" escape hatch when primary user must leave? | **Ship in MVP.** Confirmation requires **typing the exact household name** before the delete executes. | The DB schema already supports cascading deletes via existing FK constraints (System Design §7.1) — implementation cost is roughly half a day. Without this, a primary user who must exit has zero way out, which is a dead-end, not just a rough edge. High-friction confirmation matches the destructive, irreversible-for-all-members nature of the action. |
| Q11 | Legal entity for AWS Activate — required? | **Register the sole proprietorship in W0** (~₹3,000–8,000 total: GST + Udyam are free on official portals, Shops & Establishment license ₹2,500–5,000, optional professional service fees ₹1,000–5,000; ~7–10 working days), then apply for AWS Activate once registration confirmation is in hand. | Research showed AWS Activate likely doesn't strictly require a registered entity (a company website + LinkedIn presence may suffice as "verifiable existence"), but given the low cost and short timeline, registering removes any ambiguity and also unlocks GST-registered business banking needed for Razorpay/Stripe billing in v1.1. |
| Q12 | Design system → Flutter theme: hand-port or codegen? | **Hand-port** the ~60–70 CSS token constants (colors, typography, spacing, radius, elevation, motion) into `theme.dart` in W1. | The token set is small and, being locked, won't change repeatedly — codegen would be effort spent solving a problem that doesn't recur. **Drift-check convention:** a `docs/design-tokens-snapshot.json` is created alongside the W1 hand-port; any future session touching `theme.dart` or the design system diffs against that snapshot first and flags drift before proceeding. (This is a trigger-on-touch check, not a standing background monitor — acceptable since the design system is meant to be locked going forward.) |
| Q13 | Melos vs. plain pnpm for repo tooling? | **pnpm workspaces** for `api`/`web`/`shared`/`infra`; **Flutter (`mobile/`) stays a standalone peer directory**, invoked with plain `flutter` CLI commands. | Melos solves multi-package Dart/Flutter monorepo coordination — Parimaan's mobile side is a single Flutter app, so there's nothing for Melos to coordinate. |
| Q14 | Where to ask notification permission in onboarding? | **Contextual — immediately after the first shopping list is generated**, not during onboarding/sign-in. | Asking for permission before any value has been demonstrated yields lower opt-in than asking right after a concrete moment where the benefit is obvious (list changes, meal reminders only matter once a plan/list exists). **Wireframe deviation:** Flow 1 currently draws a "Notifications prompt" screen during onboarding — this must NOT be built in that position. Instead, insert the prompt into Flow 6 at the "Generate list · preview" screen (end of W11). |
| Q15 | Font licensing — SIL OFL confirmed? | **Confirmed.** All four fonts (Instrument Serif, DM Sans, JetBrains Mono, Noto Serif Devanagari) are licensed under **SIL Open Font License 1.1** — free for commercial use, embeddable, no royalties. JetBrains Mono's only restriction (can't call a modified version "JetBrains" without permission) is irrelevant since the font isn't being modified. No attribution is legally required, though an "About Parimaan" credits mention is still good practice. |

---

**PLAN LOCKED — v2.0.** All 15 decisions above are final. W0 (Prerequisites) can begin immediately: register the sole proprietorship, open both AWS accounts under one Organization, create the `parimaan@` Google account, buy domains, and apply for AWS Activate once entity registration confirms. `TECHNICAL_IMPLEMENTATION_PLAN.md` v0.1 is superseded by this document and should be treated as historical reference only.

---

## 11. W5 detailed plan — Pantry CRUD + Drift cache

**Status:** LOCKED — all decisions below are final, sign-off given 2026-08-25. Written by the **planner** agent before any W5 implementation started, then walked through six open decisions with the founder one at a time (§11.7). This section was originally drafted as a standalone `docs/plans/W5-pantry-crud-drift.md`; per the convention locked in §11.7 Q6, it is folded in here instead, and that file has been removed — **all future week-level plans, including ones with genuinely novel infrastructure, fold into this document** rather than spawning a new `docs/plans/` file.

**Budget:** originally ~10 hrs against Phase 2's ~40 hrs / 4 weeks (§7). §11.7 Q5 accepts this will run closer to ~18 hrs — see §11.5.1.
**Pipeline:** `DEV_WORKFLOW.md` §2.1 applies unmodified to every slice below. This section adds *slicing and sequencing* on top of that pipeline, not a new process.

### 11.1 What W5 is locked to deliver

| Focus | Screens | Backend/infra | DoD gate |
|---|---|---|---|
| Pantry CRUD + Drift cache | Pantry List, Add choose method, Manual add (18/49) | pantry resolvers; `onPantryChanged` sub; Drift local schema; PantryRow widget | Two-device pantry edit <5s sync |

**Added to W5 by this plan** (not in the §4 locked row): a minimal real navigation shell (Home + Pantry tabs) replacing `router.dart`'s `_HomePlaceholderScreen`. The Pantry List has nowhere to be reached from otherwise, and `PTabBar` has been built and unused since W2. Deliberately **two tabs only** — Recipes (W6), Plan (W9), List (W11) are not built here.

**Out of scope** (tracked, not forgotten): Lambda concurrency quota increase (filed, pending AWS); secret rotation; invite-code Sybil hardening; `CuisineTier1` East gap; Snacks UI unreachability; the router's unconditional `/first-run` redirect; photo-pantry AI (W18); `markMade` deduction (W12); `haveIt`/`markPurchased` (W11/W12); subscription reconnect backoff + refetch-on-reconnect (**W8**, see §11.5.2).

### 11.2 Conflicts and gaps found in the locked docs

Items marked **DECIDED** were one of the six decisions walked through with the founder (§11.7) and are final. Items marked **CALL** are judgment calls implemented as stated unless later overridden. Items marked **NOTE** are informational.

#### 11.2.1 CRITICAL, DECIDED — the locked SDL's `onPantryChanged` cannot compile as written

`SYSTEM_DESIGN.md` §6.1 lines 526–530 subscribe `onPantryChanged: PantryItem` to six mutations. AppSync requires each `@aws_subscribe`d mutation's return type to be a superset of the subscription's. Three violate it:

| Mutation | Returns | Problem |
|---|---|---|
| `bulkAddPantryItems` | `[PantryItem!]!` | A list cannot fan out to a single `PantryItem` payload. |
| `deletePantryItem` | `Boolean!` | No `PantryItem` payload exists — subscribers never learn *which* item vanished. |
| `haveIt` / `markPurchased` | `ShoppingListItem!` | Different type; also W11/W12 mutations that don't exist yet. |

(The original task brief said "those four mutations" — the doc actually lists six. Neither count works as-is.)

**DECIDED** (§11.7 Q2, changes locked SDL):
1. `deletePantryItem(id: ID!): PantryItem!` — returns the deleted row. Smallest change that makes deletion observable to other devices, which the DoD gate requires if "edit" includes delete.
2. `bulkAddPantryItems` dropped from `@aws_subscribe` in W5 — it has no W5 caller. W18 either adds `onPantryBulkChanged: [PantryItem!]` or refetches. Recorded as a W18 open item.
3. `haveIt`/`markPurchased` not listed (don't exist yet). **W11/W12 will hit the same type mismatch** — flagged forward now.

W5 ships: `onPantryChanged(householdId: ID!): PantryItem @aws_subscribe(mutations: ["addPantryItem", "updatePantryItem", "deletePantryItem"])`. This is a `doc-updater` §4.1 trigger.

#### 11.2.2 CRITICAL — the locked RLS policy does not protect `INSERT`

`SYSTEM_DESIGN.md` §7.1's example is `USING (...)` only. In Postgres, `USING` governs `SELECT`/`UPDATE`/`DELETE` row visibility; **`INSERT` is governed by `WITH CHECK`**. The existing `household_settings` policy in `api/migrations/1787072268736_baseline-schema.ts` (lines 62–68) has the same shape and has never been exercised by an insert-into-someone-else's-household test.

`pantry_items` gets `CREATE POLICY ... FOR ALL USING (<membership>) WITH CHECK (<membership>)` — explicit on both sides — plus `FORCE ROW LEVEL SECURITY` per the `1787124517648_app-role.ts` precedent. RED tests include cross-household insert *and* update, not just read. Auditing `household_settings` for the same gap is separate backlog, not W5.

#### 11.2.3 CRITICAL — `parimaan_app` has no grants on new tables

`api/migrations/1787124517648_app-role.ts` grants CRUD on an explicit `BASELINE_TABLES` list; there is no `ALTER DEFAULT PRIVILEGES`. The pantry migration must carry its own `GRANT SELECT, INSERT, UPDATE, DELETE ON pantry_items TO parimaan_app`. Easy to forget; fails at runtime in dev AWS, not at synth or in unit tests.

#### 11.2.4 DECIDED — `unit` and `category` value sets

`PantryItem.unit: String!` / `category: String` are free text in SDL and `TEXT` in SQL, with no defined value set in any locked doc. This bites later: Phase 3 DoD requires staples exclusion by "tsp/tbsp/`is_staple`/spice-oil-salt **categories**" — impossible against free text — and W12 pantry deduction can't match "kg" against "Kg".

**DECIDED (§11.7 Q1):** Option C — free-text column + server-side canonicalisation (`api/src/domain/pantryUnits.ts`, `pantryCategories.ts`): a known-value list, case/whitespace normalisation, pass-through for unrecognised values. Column stays open (a user typing "पाव" isn't rejected) while later weeks get a real set; the list is editable without a migration. Founder-approved condition: units/categories must be extensible later without much more effort — Option C satisfies this since it's a normalisation layer, not a schema-level enum.

Starting sets: units `g, kg, ml, l, piece, packet, bunch, tsp, tbsp, cup`; categories `dal, spice, dairy, produce, dry_goods, grain, oil, condiment, frozen, other`. Both are guesses from `PRD.md` §7.1 and deserve ten minutes against a real kitchen before S2 starts.

#### 11.2.5 DECIDED — `expiryDate` type mismatch

SQL: `expiry_date DATE`. SDL: `expiryDate: AWSDateTime`. A date-only column round-tripped through a timestamp acquires a spurious time-of-day and a timezone the user never chose — and "expires tomorrow" notifications then depend on which timezone the Lambda thinks it's in.

**DECIDED (§11.7 Q3):** keep SQL as `DATE`, change the SDL field to `AWSDate` (natively supported).

#### 11.2.6 CALL — `lowThreshold` semantics

`PRD.md` §7.1 offers two definitions ("user-set threshold, **or** quantity < 20% of a user-defined 'typical'"); only the first has a column. **Call:** absolute quantity in the item's own unit; running-low is `lowThreshold != null && quantity <= lowThreshold`. The 20%-of-typical variant needs a `typical_quantity` column that doesn't exist. Predicate lives in `features/pantry/domain/` as pure Dart (§3.3's push-logic-out-of-widgets rule), duplicated server-side only when W11 needs it.

#### 11.2.7 CALL — where edit and delete live (only 3 screens budgeted)

The W5 row budgets three wireframes, none an edit screen, yet `updatePantryItem`/`deletePantryItem` are W5 resolvers and the gate says "pantry **edit**". **Call:** Manual add is reused in edit mode with a seeded form — exact precedent of `household_edit_entry.dart` reusing wizard screens for the four Settings edit rows. Delete is a row action → confirm dialog (precedent `delete_household_dialog.dart`), not a fourth screen. Count stays 18/49.

#### 11.2.8 CALL — "Add choose method" offers a method that doesn't exist yet

Wireframe 9.2's whole purpose is Manual vs Photo AI; Photo is W18. **Call:** render the photo option present but disabled with a "Coming soon" `PBadge`, rather than a one-option chooser (a screen that shouldn't exist) or a live dead-end button. Same honesty posture as `settings_placeholder_screen.dart`.

#### 11.2.9 DECIDED — subscription authorization mechanism

SD §10.4 specifies a "Lambda authorizer on subscription connect". In AppSync, `AWS_LAMBDA` is an **API-level auth mode** — adopting it literally means adding a second auth mode to a currently pure-Cognito API, and the authorizer then runs on *every* request, not just subscribe.

**DECIDED (§11.7 Q4):** a **Lambda resolver on the `Subscription.onPantryChanged` field**, invoked at subscribe time, able to throw `ForbiddenError`, reusing `api/src/auth/requireHouseholdMember.ts` unchanged with RLS still behind it. Cognito stays sole auth mode. Chosen over the API-level authorizer for the same security property with far less machinery (no new IAM role/authorizer contract, no per-request invocation across unrelated fields). This is a deviation from SD §10.4's stated mechanism → both an `architect` step-2b invocation and a `doc-updater` §4.1 trigger (append SD §18). Deviation is allowed; *silent* deviation is not.

#### 11.2.10 NOTE — the codebase currently says subscriptions are W12

Three places assert it: `infra/stacks/api-stack.ts` (lines 171–173), `mobile/lib/features/household/state/household_sync_policy.dart` (lines 11–13 and its whole "belongs to W12" list). The locked plan puts `onHouseholdChanged` at **W4** (deferred — real and accepted) and `onPantryChanged` at **W5**. These three comments become wrong the moment S8 merges and must be corrected in the same PR. `onHouseholdChanged` stays deferred; retrofitting it is a natural W8 follow-on once the WebSocket link exists, and `HouseholdSyncPolicy` polling stays until then.

#### 11.2.11 NOTE — reaching `/home` at all

`_redirect` sends every signed-in user from splash to `/first-run` unconditionally (documented stopgap, out of scope). Consequence for the DoD demo: **both devices must reach the pantry within the session in which they created/joined** — a cold restart lands back on first-run. Enough to demonstrate the gate, but it makes the two-device test feel more fragile than the sync actually is. Fixing the redirect is the natural first slice of W8.

#### 11.2.12 CRITICAL, DECIDED — the S8 RED spec's "add-event inserts, update-event replaces, delete-event removes" cannot be implemented as written

Discovered mid-S8 implementation, the same way §11.2.1–§11.2.3 were. AppSync's `@aws_subscribe` mechanism forwards **the exact response of whichever mutation fired**, with no event-type discriminator — `addPantryItem`/`updatePantryItem`/`deletePantryItem` all return `PantryItem!`, so a pushed payload is structurally identical regardless of which of the three fired. There is no field to branch a local add/replace/remove on.

Two knock-on problems make a client-side patch worse than just wrong for delete:

1. A "delete" push can't be safely treated as an upsert — doing so would resurrect the row that was just removed, silently reintroducing the exact bug the DoD gate's delete case exists to catch.
2. Even for add/update, a local patch can't tell whether the changed item now matches (or stopped matching) the screen's current `search`/`category` filter — that predicate only exists server-side (`api/src/repositories/pantryRepository.ts`).

Changing the SDL to add a discriminator (e.g. wrapping `PantryItem` in a `PantryChangeEvent { changeType, item }` payload) doesn't work either: AppSync requires `@aws_subscribe`'d mutations' return type to structurally match the subscription's, and the subscription resolver only runs at subscribe time (authorization), never to reshape the push — the exact same constraint §11.2.1 already hit.

**DECIDED:** `onPantryChanged`'s payload is not surfaced to the pantry screen at all — every push (add, update, *or* delete, and the local device's own mutation echoing back) is treated as a pure "something changed, refetch" signal. `PantryRepository.watchPantryChanges(householdId)` returns `Stream<void>`; `PantryController` calls its existing `_refetch()` on every event, swallowing stream errors (the initial `fetchPantry` remains the source of truth even if the live channel never connects). This is strictly correct (the server is re-asked for truth, including the current filter) at the cost of an extra round trip per event — an acceptable trade for W5's single-household, low-frequency scope. Revisit only if W11+'s higher-volume households make the extra round trips a measured problem.

### 11.3 Slice breakdown

Nine slices, one PR each — matching the W1–W4 shape (`#17` client + first mutation + screen; `#18` one resolver; `#19` seven wizard screens; `#20` join flow + settings + members + sync policy), i.e. coherent verticals, not one-file commits. Sizes include strict-TDD overhead (§6a: +25–40%).

#### S1 — `pantry_items` migration, RLS, grants
- **Delivers:** table per SD §7.1 DDL, both indexes, `ENABLE`+`FORCE` RLS, `FOR ALL USING ... WITH CHECK ...` membership policy (§11.2.2), explicit `parimaan_app` grants (§11.2.3). No GraphQL, no app code.
- **Files:** `api/migrations/<ts>_pantry-items.ts` (new). Put grants in the *new* migration — do not edit the applied `1787124517648_app-role.ts`.
- **Depends on:** nothing. **Can start immediately.**
- **Size / Risk:** ~1.5 hrs / **Medium** — risk is entirely RLS correctness, and it's the highest-value test surface of the week.
- **Agents:** `tdd-guide` → `database-reviewer` (mandatory on every migration) → `security-reviewer` (**fires**: SQL migration + RLS policy) → `code-reviewer`.
- **RED tests** (real Testcontainers Postgres — mocked `pg` cannot exercise RLS, §3.2): member SELECTs only own-household rows; non-member SELECT returns zero rows not an error; **non-member INSERT rejected** (the §11.2.2 gap); non-member UPDATE/DELETE affect zero rows; `parimaan_app` can CRUD at all (the §11.2.3 grant); `down()` clean and re-runnable; `infra/lib/hashMigrationsDir.ts` asset test still passes.
- **Gate:** all green; both reviewers clean; deployed to dev AWS and the migration runner ran it.

#### S2 — SDL + `Query.pantry` + `addPantryItem`
- **Delivers:** `PantryItem`, `PantryItemInput`, `Query.pantry(householdId, search, category)`, `Mutation.addPantryItem` in `shared/schema.graphql`; repository, mapper, Zod validation, resolvers; two `DB_RESOLVERS` entries. Applies §11.2.4 and §11.2.5 decisions.
- **Files:** `shared/schema.graphql`; `api/src/repositories/pantryRepository.ts`; `api/src/mappers/pantryItem.ts`; `api/src/validation/{pantry,addPantryItem}.ts`; `api/src/domain/pantryUnits.ts`+`pantryCategories.ts`; `api/src/resolvers/{pantry,addPantryItem}.ts`; `infra/stacks/api-stack.ts`.
- **Depends on:** **S1**.
- **Size / Risk:** ~2 hrs / **Low-Medium** — well-worn W3/W4 path; only `search`/`category` filtering is new.
- **Agents:** `tdd-guide` → `typescript-reviewer` → `security-reviewer` (**fires**: new Lambda resolvers + SQL construction) → `code-reviewer` → `doc-updater` (SDL change → re-sync SD §6.1).
- **RED tests** (§3.2's mandated order): non-member → `ForbiddenError` on both fields; Zod rejections (blank name, negative/NaN quantity, missing unit, over-long strings, unknown category if closed); happy path; `search` is a parameterised `LOWER(name) LIKE` using `idx_pantry_household_name` and **injection-proof** (a `search` of `%' OR '1'='1` returns zero rows, not the table); `search`+`category` combined; `addedBy` taken from verified caller identity, never from input.
- **Gate:** ≥80% coverage; `pnpm -r` regenerates Ferry/TS clients with a clean tree (§6d SDL-drift guard).

#### S3 — `updatePantryItem`, `deletePantryItem`, `bulkAddPantryItems`
- **Delivers:** remaining three mutations incl. the §11.2.1 `deletePantryItem: PantryItem!` change. `bulkAddPantryItems` is built (it's a locked W5 deliverable) but has **no W5 client** and is **not** on `@aws_subscribe`.
- **Depends on:** **S2**.
- **Size / Risk:** ~1.5 hrs / **Low-Medium**. Risk concentrates in `bulkAddPantryItems`: needs a transaction and a bound on `items.length` — an unbounded list is trivially-exploitable resource exhaustion on a VPC Lambda with a 45s timeout and no RDS Proxy.
- **RED tests:** update/delete in another household denied, **identically to a nonexistent id** (never an existence oracle — the convention `household.ts` already sets); `updatePantryItem` is a partial patch (absent = unchanged, explicit `null` rejected — matching `updateHouseholdSettings`'s locked semantics); `updated_at` actually moves; `deletePantryItem` returns the deleted row and second call denies; bulk over cap → `VALIDATION`; bulk rolls back entirely when item *k* fails (§3.2's mandated rollback test).

#### S4 — Navigation shell (Home + Pantry tabs)
- **Delivers:** a real `StatefulShellRoute` at `/home` with two branches rendered through the existing `PTabBar`. `_HomePlaceholderScreen` is **deleted, not grown** (its own doc comment asks for exactly this). Home branch keeps the "Household settings" affordance so nothing regresses. Pantry branch renders an empty scaffold S5 fills.
- **Files:** `mobile/lib/app/router.dart` (+ `AppRoutes.pantry`); `mobile/lib/features/shell/presentation/app_shell.dart` (new); `mobile/lib/features/home/presentation/home_screen.dart` (new, minimal); `mobile/test/app/router_test.dart`.
- **Depends on:** **nothing.** Fully parallel with S1–S3 — the one slice workable while backend slices are in review.
- **Size / Risk:** ~1.5 hrs / **Low-Medium**. Risk is shell-route mechanics vs `_redirect`: a `StatefulShellRoute` changes what `state.matchedLocation` reports for branch routes, and the redirect's "leave every other signed-in location alone" branch must keep behaving.
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`. `security-reviewer` **skips** (§2.3 — pure navigation/presentation; redirect logic itself unchanged).
- **RED tests:** `/home` renders a two-item `PTabBar`; tapping Pantry switches branch and **preserves Home branch state** (the point of a stateful shell); deep-link to `/home/pantry` while signed out still bounces to `/sign-in`; existing router tests pass unmodified. No golden — goldens are design-system-only (§3.3), and `PTabBar` already has its own.

#### S5 — Pantry read path: Ferry ops, domain model, repository, `PantryRow`, Pantry List
- **Delivers:** wireframe 9.1 against the network only — no cache, no subscription yet. `PantryRow` (the W5-named domain widget), search field + category chips driving the **server-side** `search`/`category` params, empty/loading/error states via `PEmptyState`.
- **Files:** `mobile/lib/shared/graphql/operations/pantry.graphql` + regenerated `__generated__/`; `mobile/lib/features/pantry/domain/{pantry_item,pantry_unit,pantry_category,running_low}.dart`; `.../data/{pantry_repository,pantry_mapper}.dart`; `.../state/pantry_controller.dart`; `.../presentation/{pantry_list_screen,pantry_row}.dart`.
- **Depends on:** **S2** and **S4**.
- **Size / Risk:** ~2.5 hrs / **Medium** — largest Flutter slice; mitigated by following the `household` feature's existing repository/controller/mapper layering rather than inventing one.
- **RED tests:** *Domain* — running-low predicate incl. null threshold, equal-to-threshold boundary, zero quantity. *State* — family provider scoped by `householdId` emits `loading → data`; errors surface as `AppError` via `graphql_error_mapper.dart`; search input **debounced** so typing doesn't produce a request per keystroke against a cold Aurora. *Widget* — empty state before data; error state on repo throw; `PantryRow` renders quantity+unit, staple badge, running-low affordance, expiry.

#### S6 — Add-item choose-method + Manual add (+ edit + delete)
- **Delivers:** wireframes 9.2 and 9.3. Manual add → `addPantryItem`; same screen in edit mode (§11.2.7) → `updatePantryItem`; row delete with confirm → `deletePantryItem`. Photo option present-but-disabled (§11.2.8).
- **Files:** `mobile/lib/features/pantry/presentation/{add_method_screen,manual_add_screen,pantry_item_edit_entry,delete_pantry_item_dialog}.dart`; `.../state/pantry_form_controller.dart`; routes in `router.dart`.
- **Depends on:** **S3** and **S5**.
- **Size / Risk:** ~2.5 hrs / **Medium**. Risk is validation duplication — S2's Zod rules mirrored in Dart without drifting. Mitigation: pure-Dart validators in `features/pantry/domain/`, unit-tested against the *same case table* as the Vitest suite, and treat a server `VALIDATION` error as a legitimate render path rather than assuming client validation suffices.
- **RED tests:** submit disabled until name+quantity+unit valid; server `VALIDATION` renders inline; success pops back and the list contains the item; edit mode seeded from the existing item and **unchanged fields are not sent** (partial patch); cancel mutates nothing; delete requires confirm, cancel is a no-op; the photo option is disabled and announces itself as such to screen readers.

#### S7 — Drift local read cache *(new infrastructure — full pipeline)*

First local database in this codebase; own design decision per §2.2 step 2b of the pipeline. **Ships within W5, not deferred** — §11.7 Q5 decided to accept a two-week W5 with full scope rather than pushing this to W8.

| # | Step | Agent | Concrete action | Gate |
|---|---|---|---|---|
| 1 | Research & Reuse | *none* | **Mandatory.** `gh search code "drift" riverpod cache`; Drift docs via Context7 for the current codegen story and its interaction with the existing `ferry_generator`+`built_value_generator` pipeline (three generators in one `build.yaml` is where this slice actually breaks). pub.dev versions of `drift`/`sqlite3_flutter_libs`/`path_provider` against Flutter SDK `^3.13.0`. Explicitly evaluate the cheaper alternative: **ferry's own persisted (Hive) store**, for which `client.dart` already has a hook (it takes an optional `Cache`). | Adopt-vs-alternative decision written down. |
| 2 | Plan (novel arch) | `architect` | Record: (a) Drift vs persisted ferry cache — SD §9.1 says Drift, so choosing otherwise is a locked-decision deviation needing §4.1 treatment; (b) **read cache only** — mutations go straight to network, no offline queue (SD §9.1); (c) staleness — hydrate-then-fetch, network result overwrites wholesale, no merge; (d) **eviction on household switch and on sign-out** — a pantry cache surviving sign-out on a shared family phone is a privacy leak, and it's the same concern `client.dart` already names as why its ferry cache is in-memory. | Decision in SD §18 via `doc-updater`. |
| 3 | RED | `tdd-guide` | `NativeDatabase.memory()` for tests; schema round-trips every field incl. nulls and `DATE`; controller emits `cached → fresh` in that order; a network failure **after** a successful hydrate leaves cached rows visible with an error banner, not an empty screen (the whole value of the cache); sign-out clears the table; a v1→v2 schema migration runs (proves the path exists before it's needed in anger). | Failures shown. |
| 4 | GREEN | *none* | `mobile/lib/shared/storage/{app_database.dart,tables/pantry_items_table.dart,daos/pantry_dao.dart}` — `shared/storage/` is already the path SD §9.1's tree specifies. Wire hydrate-then-fetch into `pantry_controller.dart`. | Tests pass. |
| 5 | REFACTOR | `tdd-guide` | Generated Drift code excluded from coverage and lint; no file >400 lines; the DAO is the only thing touching the DB (no Drift types leak into `presentation/`). | Clean. |
| 6 | Domain review | `flutter-reviewer` | — | Addressed. |
| 7 | Security | `security-reviewer` | **FIRES** — new third-party SDK (§2.3's "third-party SDK addition of any kind") **and** a new at-rest store of household data on device. Check: DB file in app-private storage not shared/external; no tokens or PII beyond pantry contents; cleared on sign-out; not backed up to iCloud/Google Drive unless deliberate. | No CRITICAL/HIGH. |
| 8 | General | `code-reviewer` | — | Clean. |
| 9 | Docs | `doc-updater` | SD §9.1 confirmed-or-amended; new dependency noted. | Synced. |

**Depends on:** S5. **Size / Risk:** ~2.5 hrs / **High** — three code generators in one `build_runner` pipeline is the single most likely place this week burns an unplanned hour (`build-error-resolver` on standby).

**Steps 1–2 result:** Drift confirmed (SD §9.1 amendment, 2026-08-26) — `drift 2.34.3`/`drift_flutter 0.3.1`/`sqlite3_flutter_libs 0.6.0+eol` all current and compatible with this app's `^3.13.0` SDK constraint (the `+eol` version suffix is `drift_flutter`'s own official dependency pin, not a deprecation warning — the package's *name* is being retired in favor of a future `sqlite3`-native story, but this pinned version remains the correct, actively-maintained dependency today). The required cheaper-alternative check — Ferry's own persisted (Hive) `Cache`, which `client.dart` already has a hook for — was ruled out: `hive`/`hive_flutter` last published 2021–2022, targeting a pre-null-safety-only SDK range, unmaintained. `gh search code` prior art (`BCNelson/tendant`) confirmed `drift_dev`'s builders coexist in one `build.yaml` alongside `ferry_generator`'s with no special ordering needed — the three-generators risk this slice is sized around is real (see the working-order note below) but not a known incompatibility.

#### S8 — `onPantryChanged` subscription *(new infrastructure — full pipeline)*

First subscription in the app. This is the slice the DoD gate actually measures.

| # | Step | Agent | Concrete action | Gate |
|---|---|---|---|---|
| 1 | Research & Reuse | *none* | **Mandatory.** AppSync's real-time protocol is *not* plain `graphql-ws` — it's AWS's own protocol over a `wss://...appsync-realtime-api...` URL with a base64'd `header` query param carrying auth. Ferry ships no AppSync transport. `gh search code "appsync" dart websocket link`; check pub.dev for an existing `gql_websocket_link`-on-AppSync adapter **before** hand-rolling. Hand-rolling the handshake from AWS docs is a multi-hour task and there is prior art. | Adopt-vs-hand-roll decision written down, package named (or its absence). |
| 2 | Plan (novel arch) | `architect` | Record: (a) the §11.2.9 subscription-resolver-vs-API-auth-mode decision and its SD §10.4 deviation; (b) **one WebSocket link for the whole app**, multiplexed (SD §9.1) — so it belongs in `shared/graphql/` alongside `AuthLink`, not in `features/pantry/`; (c) token refresh mid-connection — the ID token is 1-hour (SD §10.2) and a WebSocket outlives it, so reconnect must fetch a fresh token, not replay the connect-time one; (d) **W5 ships subscribe-on-foreground / unsubscribe-on-background and nothing more** — backoff 1s→2s→5s→15s→60s and invalidate-and-refetch-on-reconnect are explicitly the **W8** row's deliverables, and pulling them forward is how W5 overruns further. | Decisions in SD §18. |
| 3 | RED | `tdd-guide` | *Backend (Vitest):* non-member subscribe → `ForbiddenError`; member → authorized; nonexistent householdId denies identically. *CDK (`assertions`, fine-grained before snapshot, §3.4):* `Subscription.onPantryChanged` resolver exists and is Lambda-backed; that Lambda is VPC-attached with the shared security group; API auth mode is **still** user-pool-only. *Flutter:* add-event inserts, update-event replaces in place, delete-event removes; an event for a **different** `householdId` is ignored; an event for an item already present (the local device's own mutation echoing back) does not duplicate the row. | Failures shown. |
| 4 | GREEN | *none* | SDL `Subscription` type (§11.2.1's trimmed list); `api/src/resolvers/onPantryChanged.ts`; `api-stack.ts` entry (the existing `DB_RESOLVERS` loop already generalises to `typeName: 'Subscription'`); `mobile/lib/shared/graphql/{appsync_websocket_link,subscription_client}.dart`; wire into `pantry_controller.dart`. | Tests pass. |
| 5 | REFACTOR | `tdd-guide` | The WebSocket link is generic over any subscription, not pantry-shaped — W8/W11/W12 add three more topics. | Clean. |
| 6 | Domain review | `flutter-reviewer` + `typescript-reviewer` **in parallel** (§6b) | — | Addressed. |
| 7 | Security | `security-reviewer` | **FIRES** — subscription authorizer path, new resolver, token handling over a long-lived connection, CDK/IAM change. Specifically: the ID token is not logged; a token expiring mid-connection does not silently keep an unauthorized subscriber attached; `householdId` from the subscribe request is validated, not trusted. | No CRITICAL/HIGH. |
| 8 | General | `code-reviewer` | SDL↔Ferry↔Zod contract drift (§6d). | Clean. |
| 9 | Docs | `doc-updater` | SD §6.1 re-sync; SD §10.4 deviation; **correct the three stale "subscriptions are W12" comments** (§11.2.10). | Synced. |

**Depends on:** S3 and S5. S7 is **not** a dependency — cache and subscription are independent. **Size / Risk:** ~3 hrs / **High** — highest-risk slice, and the one the DoD gate depends on.

**Step 1 result (adopt-vs-hand-roll):** hand-rolled. Three pub.dev candidates checked: `aws_appsync_subscription` is an abandoned 2022 package speaking AppSync's separate MQTT-based Events API, not GraphQL subscriptions; `aws_appsync_api` is a control-plane REST client (creating AppSync resources), not a runtime GraphQL transport; `aws_appsync` is a 2020 stub with no realtime code at all. `aws-amplify/amplify-flutter`'s `amplify_api_dart` package *does* implement this protocol correctly, but only as an unexported internal (`src/graphql/web_socket/...`) of the full Amplify plugin architecture — reachable only via `Amplify.API`, which would also violate this codebase's own locked SD §18 decision that Amplify stays scoped to OAuth (`amplify_auth_cognito`) and everything else stays hand-rolled. Hand-rolled against AWS's public real-time protocol docs, in `mobile/lib/shared/graphql/appsync_realtime_protocol.dart` (pure frame-shape helpers) + `subscription_client.dart` (the stateful multiplexed connection) + `appsync_websocket_link.dart` (the `gql_link` `Link` routing subscriptions to it) — `aws-amplify/amplify-flutter`'s implementation used only as a design reference, never a dependency.

**Step 3 result:** the RED spec's "add-event inserts, update-event replaces, delete-event removes" turned out not to be implementable against AppSync's actual push mechanism — see §11.2.12 for the finding and the refetch-on-any-event decision that replaced it. The Flutter RED tests actually written assert that behavior instead: a pushed event (of any kind) triggers a refetch; a stream error is swallowed without disturbing the last good list; disposing the controller cancels the subscription.

#### S9 — Two-device verification, weekly doc pass
- **Delivers:** the DoD gate measured — two real devices, two Google accounts, one household; add/edit/delete on A appears on B, **timed**, target <5s. Result written with the actual number, not "felt fast". Plus §4.2's mandatory weekly pass: actual-vs-planned hours into this document's §4 W5 row.
- **Files:** `docs/E2E_MVP_PLAN.md` (§4 W5 actuals + this §11); `docs/RUNBOOK.md` (two-device verification procedure — it gets re-run at W8, W11, W12).
- **Depends on:** S6 + S8 + S7 (all three — no slice is deferred out of W5, per §11.7 Q5).
- **Size / Risk:** ~1 hr / **Low** risk but **non-optional**: §6d says a week isn't done until its §4 row has actuals, and §6a's W8 checkpoint has nothing to measure without it.
- **Agents:** `doc-updater`. No `security-reviewer` phase sweep — that's a W8 boundary obligation (§2.3 exception 1), not W5's.

### 11.4 Sequencing

```
        can start immediately, in parallel
        ┌──────────────────────────────────────────┐
   ┌────▼────┐                              ┌──────▼──────┐
   │ S1 mig  │                              │ S4 nav shell│
   │ + RLS   │                              │  (Flutter)  │
   └────┬────┘                              └──────┬──────┘
   ┌────▼──────────────┐                           │
   │ S2 SDL + pantry   │                           │
   │    + addPantryItem│                           │
   └────┬──────────────┘                           │
   ┌────▼──────────────┐                           │
   │ S3 update/delete/ │                           │
   │    bulk           │                           │
   └────┬──────────────┘                           │
        │              ┌───────────────────────────┘
        │        ┌─────▼─────────────────┐
        └───────►│ S5 read path + list   │
                 │    + PantryRow        │
                 └──┬─────────────┬──────┘
          ┌─────────▼──┐   ┌──────▼───────────┐
          │ S6 add/    │   │ S7 Drift cache   │  (independent of each other AND
          │    edit/del│   │                  │   of S8 — but both ship in W5)
          └─────────┬──┘   └──────┬───────────┘
          ┌─────────▼─────────────▼──┐
          │ S8 onPantryChanged sub   │  (needs S3 + S5; NOT S7)
          └─────────────┬────────────┘
                 ┌──────▼───────┐
                 │ S9 verify+docs│
                 └───────────────┘
```

**Working order: S4 → S1 → S2 → S3 → S5 → S6 → S8 → S7 → S9.**

Two non-obvious choices, with rationale:
- **S4 first, not last.** Only zero-dependency Flutter slice; deletes a known stopgap; de-risks go_router shell mechanics *before* a real screen depends on it. Starting with a small merged PR also gives the §6a hours log something honest to measure early.
- **S8 before S7.** S8 is the DoD gate; S7 is not. Doing the gate-measured slice first means the two-device timing number exists well before the week ends, even though (per §11.7 Q5) S7 is no longer being cut if the week runs long.

### 11.5 Risks

#### 11.5.1 The week does not fit in 10 hours — DECIDED

| Slice | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|
| hrs | 1.5 | 2.0 | 1.5 | 1.5 | 2.5 | 2.5 | 2.5 | 3.0 | 1.0 | **18.0** |

Against ~10 hrs, that's a **~80% overrun before any surprise**. Not padding: W5 contains two greenfield infrastructure pieces, five backend resolvers, three screens, a nav shell, and full strict TDD at 80% on all of it. The W1–W4 weeks that shipped comparable volume were single-concern.

**DECIDED (§11.7 Q5): accept a two-week W5.** All nine slices ship, full scope, no deferrals. This was decided against the planner's original recommendation (defer S7 to W8) — the founder chose to keep the Drift cache in W5 rather than let it drift (no pun intended) into the "Sync polish" week. Consequence: W5 spends roughly 8 hrs of the §7 20-hr buffer and W6 slides by about the same amount. Phase 2's overall exit line ("Drift local read-cache hydrates offline") stays a **W5** deliverable, not a Phase-2-wide one.

#### 11.5.2 Subscription reliability is not fully solved in W5, by design
W5 ships subscribe/unsubscribe and fanout. Backoff, refetch-on-reconnect, and 5-concurrent-client load are W8 and W11 (risk R3). A two-device demo on good wifi will pass while the mechanism is still fragile on a subway. **Do not let S9's green light read as "sync is done"** — record the gap so W8 inherits it explicitly.

#### 11.5.3 The three-generator `build_runner` pipeline (S7)
`ferry_generator` + `built_value_generator` + `drift_dev` in one `build.yaml` is the concrete failure mode most likely to eat an hour. Contained entirely within S7.

#### 11.5.4 Real-AWS verification cost
Every backend slice needs a real dev deploy to be honestly verified (the W4 commit established this repo verifies against real AWS, not synth). With Aurora auto-pause (non-negotiable cost lever, `PRD.md` §17.4) the first request after a pause can take ~30s — budget for it and don't mistake a cold start for a broken resolver. The Lambda concurrency quota increase is filed and pending; nothing in W5 depends on it landing.

#### 11.5.5 §4 actuals (S9, the §4.2 calendar-backstop pass)

The planned-hours table above (§11.5.1) sums to 18.0 hrs across S1–S9. **Actual hours were not tracked with stopwatch/calendar precision this week** — a real process gap, not a rounding choice, being recorded honestly rather than backfilled with an invented number. Two things are true instead:

- **Every slice ran at least once as its own dedicated implementation pass** (research → RED → GREEN → refactor → domain review → security review where triggered → docs), matching the pipeline `DEV_WORKFLOW.md` §2.1 specifies — the *shape* of the planned process was followed even though the *hours* weren't logged against it in real time.
- **S7 and S8 concretely ran over their own estimates** (2.5 hrs and 3 hrs respectively) — not by feel, but by what each slice's PR actually needed beyond its RED/GREEN pass: S8 needed a second implementation pass after `flutter-reviewer` caught three real connection-state-machine bugs (a hang, a permanently-poisoned client, a use-after-cancel crash) plus a CI infra-timeout fix unrelated to the slice's own code; S7 needed a `drift_dev`/`analyzer` version-conflict resolution before it would even build, plus a second pass after `flutter-reviewer` caught two real HIGH-severity bugs (a cache-write failure discarding a good fetch result; a cache-eviction failure that could strand the router in a signed-in state after a real sign-out). Both overruns are the §11.5.1 "80% overrun before any surprise" framing playing out exactly as flagged going in — real bugs caught by real review, not process waste.
- **Carry-over into W6:** none of the above blocks W6 — every W5 slice is merged (S1–S8) or has only the human-run two-device timing left (S9, this section). The concrete carry-over is procedural: **start logging real session wall-clock time per slice from W6 onward** (a timestamp at slice start and at PR-open is enough) so this section can report a real number instead of "not tracked" next time the §4.2 backstop runs.

**§4 W5 row (this document's line 157):** DoD gate "Two-device pantry edit <5s sync" — **functionally verified 2026-08-26**, with an honest caveat on the timing precision. Run against two iOS Simulators (not the two physical devices `RUNBOOK.md` §3 prescribes) signed into two separate Google accounts, against the real dev AppSync/Lambda/Aurora stack (not synth/local). Add, edit (toggle `isStaple`), and delete were each performed once on one device and confirmed to appear on the other **without any manual refresh**, each observed within the same wall-clock minute as the triggering action — well inside the <5s target on inspection, but **not stopwatch-timed to sub-5-second precision**: the agent driving both simulators has multi-second tool-call round-trips (screenshot → reasoning → next action) that make a literal stopwatch number from this agent unreliable, so no fabricated number is recorded. `RUNBOOK.md` §3's two-sample, physical-device, stopwatch-precision run is still outstanding and should be done by a human before this gate is treated as fully closed — nothing else in W5 blocks it.
- **Two real production bugs were found and fixed in the course of this run**, neither of which any existing test caught: (1) the dev backend was stale (last deployed before this week's pantry work merged to `main`), fixed by redeploying `Parimaan-dev-Data`/`Parimaan-dev-Api` via CDK; (2) `Query.pantry`, `Mutation.addPantryItem`, and `Mutation.bulkAddPantryItems`'s Zod schemas used `.optional()` on nullable fields, which rejects the explicit `null` a real AppSync/Ferry client sends for an unset field (every existing test only ever exercised `undefined`) — fixed by switching to `.nullish()` in `api/src/validation/pantry.ts` and `api/src/validation/addPantryItem.ts` plus matching resolver-level `== null` checks in `pantry.ts`/`addPantryItem.ts`/`bulkAddPantryItems.ts`, with 3 new regression tests (503/503 `api` tests green). These fixes are deployed to dev but were not yet committed to git as of this pass — see the PR for this slice.

### 11.6 W5 exit criteria

- [x] `pantry_items` on dev with RLS **enabled and forced**, policy covering `USING` **and** `WITH CHECK`, `parimaan_app` grants — verified by wrong-household tests for read, insert, update, delete (S1, `#26`)
- [x] All five pantry resolvers live on dev, each member-gated, each with a non-member denial test (S2/S3, `#30`/`#31`)
- [x] `search` parameterised and proven injection-safe (S2)
- [x] `shared/schema.graphql` re-synced into SD §6.1, incl. §11.2.1 `deletePantryItem` and §11.2.5 `AWSDate` with rationale
- [x] `_HomePlaceholderScreen` deleted; `/home` is a real two-tab shell using `PTabBar` (S4, `#25`)
- [x] Wireframes 9.1, 9.2, 9.3 shipped → **18/49** (S5/S6, `#32`/`#33`)
- [x] `PantryRow` built and covered (S5)
- [x] `onPantryChanged` fans out add/update/delete across two devices — **functionally verified** 2026-08-26 on two iOS Simulators against real dev AWS (§11.5.5); each change appeared on the other device with no manual refresh, well inside 5s on inspection. **Not yet stopwatch-timed to sub-5s precision on physical devices per RUNBOOK.md §3** — that two-sample physical run is a real remaining gap, not blocking anything else in W5
- [x] Subscription connect is membership-authorized; a non-member's subscribe is rejected (test, not inspection) (S8, `#34`)
- [x] Drift read cache hydrates before the network responds — ships in W5, not deferred (§11.5.1) (S7, `#35`)
- [x] Coverage: Flutter domain+state 87.0% (`lib/**/domain/`, `lib/**/state/` — measured via `flutter test --coverage`, 618/710 lines), comfortably over the ≥80% target (§0 amendment). Lambda coverage **now measured**, 2026-08-26: `@vitest/coverage-v8` installed in `api/` (matched to the resolved `vitest@3.2.7`), `api/vitest.config.ts` configured with a v8 provider, an aggregate (not per-file) 80% threshold on lines/statements/branches/functions, and exclusion of pure-type `types.ts` files that have no runtime code to exercise. Result: **94.06% lines** (91.48% branches, 89.2% functions), comfortably over target. Wired into CI as a new `Lambda coverage (api)` step in `.github/workflows/pr.yml` (`pnpm --filter api test:coverage`), so this stays enforced going forward rather than being a one-off measurement.
- [x] `security-reviewer` clean on S7 and S8 (confirmed directly this session, no findings on either). S1/S2/S3 were reviewed earlier in this same W5 effort per the standing per-slice workflow, but not re-verified in this pass — taken on trust from that established practice, not re-run.
- [x] This document's §4 W5 row has actual hours and carry-over — see §11.5.5
- [x] The three stale "subscriptions are W12" comments corrected (fixed in S8's PR)

### 11.7 W5 planning decisions (final, locked 2026-08-25)

| # | Question | **Locked decision** |
|---|---|---|
| Q1 | §11.2.4 — `unit`/`category`: free text, closed enums, or canonicalisation? | **Option C** — free text + server-side canonicalisation, condition on remaining easily extensible later. |
| Q2 | §11.2.1 — `deletePantryItem` returns `PantryItem!`? (locked-SDL change) | **Yes** — delete is otherwise invisible to other devices. |
| Q3 | §11.2.5 — `expiryDate` → `AWSDate`? (locked-SDL change) | **Yes.** |
| Q4 | §11.2.9 — subscription-field resolver instead of SD §10.4's API-level Lambda authorizer? | **Yes, per-field resolver** — same security property, far less machinery, Cognito stays sole auth mode. Chosen after a clarifying discussion of complexity/response-time/cost tradeoffs against the API-level authorizer alternative. |
| Q5 | §11.5.1 — how to absorb the ~18 hr vs 10 hr gap? | **Accept a two-week W5.** Full 9-slice scope, no deferrals — chosen over the planner's recommendation to defer S7 (Drift) to W8. |
| Q6 | Is `docs/plans/W<n>-<slug>.md` the convention, or fold into this document? | **Fold into `E2E_MVP_PLAN.md`.** This is a standing convention, not a one-off: every future week's plan — including weeks with novel infrastructure — folds into this document rather than a separate file. `docs/plans/W5-pantry-crud-drift.md` has been removed; this §11 is its sole remaining copy. |

---

## 12. W6 detailed plan — Structured recipes + roles

**Status:** LOCKED, 2026-08-26. Drafted by the **planner** agent following §11's structure, then walked through decision-by-decision with the founder. All nine decisions (D1–D9) are locked below — see §12.7. **W6 is a two-week sprint** (D8), same pattern as W5.

**Budget:** ~10 hrs nominal against Phase 2's ~40 hrs / 4 weeks (§7). Locked scope estimates **~20.0 hrs** (§12.5.1) — a 100% overrun before any surprise, on top of a §7 buffer that W5 already spent ~8 of its 20 hours from. Accepted knowingly (D8): Phase 2 (W5–W8) is now effectively a ~6-calendar-week stretch, and the buffer will be essentially gone by W8.

**Pipeline:** `DEV_WORKFLOW.md` §2.1 applies unmodified to every slice below. Per §11.7 Q6 this plan folds into this document rather than a `docs/plans/` file.

**Process carry-over from W5 (§11.5.5):** log real wall-clock time per slice this week — a timestamp at slice start and at PR-open — so §12.5.1's estimate table can be checked against reality rather than reporting "not tracked" again.

### 12.1 What W6 is locked to deliver

| Focus | Screens | Backend/infra | DoD gate |
|---|---|---|---|
| Structured recipes + roles | Recipes Library, Detail, Overflow menu, **Structured form** (D2 — pulled forward from W7) | recipe resolvers (all five mutations); `role` enum (meal-slot, required, no default — D1); `onRecipeChanged` sub (D6 — pulled forward from W8); favorite + rotation flags; RecipeCard widget | Recipe CRUD complete (server + mobile UI); role assignment required; two-device recipe sync <5s |

Plus, from §6 R7: **W6 spike, benchmark 300-item list scroll on a Redmi-class device** — confirmed staying in W6, not sliding (D9).

**Added to W6 by this plan** (not in the original §4 row, now folded into it above):
- A third tab (Recipes) in the W5 nav shell — `app_shell.dart`'s own doc comment already names this as W6's job.
- `recipe_ingredients` RLS (§12.2.2) — a security hole in the locked DDL, not an enhancement.
- Server-side enum canonicalisation/**rejection** for `role`/`cuisineTier1`/`dietaryTags` (§12.2.6, D4) — deliberately the opposite strategy from W5's pantry-unit pass-through, because these are closed GraphQL enums where a bad row breaks the whole `Query.recipes` response.
- `onRecipeChanged` subscription + two-device verification (D6) — not originally in W6's row at all.

**Out of scope** (tracked, not forgotten): URL import and freeform AI parse (**W7** — a separate spike week); recipe *picker* filtered by slot role (**W9/W10**); `autoFillWeek` consumption of `in_rotation` (**W10**); curated 50-recipe seeding (**W13/W14**); recipe cover images / S3 `recipe-images/` (nowhere in the sprint table — §12.2.11); duplicate-recipe action (PRD §7.1 — §12.2.10, unscheduled, founder to place in W14 or v1.1); allergen/skip-ingredient warnings at pick time (W9/W10); the router's unconditional `/first-run` redirect (§11.2.11, still open, still W8's first slice); subscription reconnect backoff (**W8**); Drift local cache for recipes (**W14**, D7).

### 12.2 Conflicts and gaps found in the locked docs

Items marked **LOCKED** were open decisions in the planner's draft, now resolved by the founder (§12.7 has the full table). Items marked **CALL** are judgment calls implemented as stated. Items marked **NOTE** are informational or forward-flags for later weeks.

#### 12.2.1 CRITICAL, LOCKED (D2) — "Recipe CRUD complete" needs a create/edit screen W6's original budget didn't have

The original §4 W6 row budgeted three wireframes — Library, Detail, Overflow menu (Flow 7) — none of which is a create or edit screen. The structured-entry form is wireframe 8.2, originally W7's. **Locked: pull it forward into W6** (Option B). Cost: +~2.5 hrs (S8, below). Consequence: W6's running screen count is **22/49** (not 21/49); W7's cumulative count is unaffected (still 27/49 by end of W7 — the same 49 screens, just one moves earlier) since it drops one screen from its own row. §4's W6/W7 rows already reflect this.

#### 12.2.2 CRITICAL — `recipe_ingredients` has no RLS, and RLS on `recipes` does not cascade to it

`SYSTEM_DESIGN.md` §7.1's RLS block enables row-level security on `recipes`, `pantry_items`, `menus`, `menu_items`, `shopping_lists`, `shopping_list_items`, `household_settings`. **`recipe_ingredients` is not in that list**, and it is the only household-scoped child table in the schema with **no `household_id` column** (SD §7.1 lines 703–713: `recipe_id`, `name`, `quantity`, `unit`, `category`, `notes`, `is_staple`, `sort_order`).

Postgres RLS is per-table. A policy on `recipes` does nothing for `SELECT * FROM recipe_ingredients WHERE recipe_id = $1`. Since `parimaan_app` will hold `SELECT` on that table, a resolver bug that passes an unvalidated `recipeId` through leaks another household's ingredient list with layer 3 offering zero protection — the recipe-side analogue of §11.2.2/§11.2.3.

**Call:** the W6 migration enables and **forces** RLS on `recipe_ingredients` with a parent-join policy:

```
FOR ALL
USING (recipe_id IN (SELECT id FROM recipes))
WITH CHECK (recipe_id IN (SELECT id FROM recipes))
```

The inner `SELECT id FROM recipes` is itself RLS-filtered to the caller's households, so this composes with `recipes`' own policy rather than duplicating the membership subquery. Both clauses explicit (§11.2.2's lesson), `FORCE` not just `ENABLE`, explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_ingredients TO parimaan_app` in the same migration (§11.2.3's lesson). This is a `doc-updater` §4.1 trigger (SD §7.1's RLS list gains a line).

The RED tests for S1 must include a non-member reading `recipe_ingredients` *by `recipe_id` directly*, not only through the `recipes` join — the test that would have caught this.

#### 12.2.3 CRITICAL, LOCKED (D3) — `RecipeInput`/`RecipeIngredientInput` did not exist in any locked document

`SYSTEM_DESIGN.md` §6.1 declares `createRecipe(householdId, input: RecipeInput!)` then closes the SDL block with "input types omitted for brevity — mirror the Type shapes." Mirroring the `Recipe` type verbatim would give the client `id`, `householdId`, `sourceType`, `isFavorite`, `inRotation`, and server-owned ingredient ids — several of which a client must never supply. **Locked shape:**

```
input RecipeInput {
  title: String!
  description: String
  servings: Int            # defaults to 4 server-side if absent (SD §7.1 column default)
  prepMin: Int
  cookMin: Int
  cuisineTier1: CuisineTier1
  cuisineTier2: String
  dietaryTags: [DietaryTag!]
  role: RecipeRole!        # REQUIRED — no default (D1). This is the "role assignment required" gate.
  inRotation: Boolean      # defaults TRUE (PRD §7.1: "default: true when created")
  ingredients: [RecipeIngredientInput!]!
  steps: [String!]!
}

input RecipeIngredientInput {
  name: String!
  quantity: Float
  unit: String
  category: String
  notes: String
  isStaple: Boolean
}
```

No `id`, no `householdId`, no `sourceType` (server-set: `user` for W6's `createRecipe`; W7 sets `url`/`freeform_ai`; W14 sets `curated`; W19 sets `ai`), no `isFavorite`. `sortOrder` is not client-supplied — it is the array index.

#### 12.2.4 CONFLICT, LOCKED (D3) — `updateRecipe` takes `RecipeInput!` (full replace) against this codebase's locked patch convention

Two shipped mutations establish partial-patch semantics with a dedicated patch input: `updateHouseholdSettings(HouseholdSettingsInput)` and `updatePantryItem(PantryItemPatchInput)` — "every field optional, absent = leave unchanged, explicit `null` rejected." SD §6.1's `updateRecipe(id, input: RecipeInput!)` reuses the create input, exactly what W5 rejected for pantry.

Genuine wrinkle: `ingredients`/`steps` are lists, and a patch cannot express "change ingredient 3" sensibly. **Locked:** `RecipePatchInput` where every scalar is optional (absent = unchanged, explicit `null` rejected — the locked convention), and `ingredients`/`steps` are optional but **replace the whole list when present** (`DELETE FROM recipe_ingredients WHERE recipe_id = $1` then re-insert, same transaction). Documented on the SDL field — "optional but wholesale" is a new semantic this schema hasn't used before.

#### 12.2.5 CONFLICT, LOCKED (D3) — `deleteRecipe: Boolean!` → `deleteRecipe(id: ID!): Recipe!`

W5 changed `deletePantryItem` from `Boolean!` to `PantryItem!` (§11.7 Q2) so a subscriber learns *which* item vanished. SD §6.1 still has `deleteRecipe(id: ID!): Boolean!`. With `onRecipeChanged` now shipping in W6 (D6), the same rationale applies immediately, not just in the future. **Locked: `deleteRecipe(id: ID!): Recipe!`**, matching the pantry precedent.

**Related NOTE, forward-flag:** `menu_items.recipe_id` is `ON DELETE CASCADE`, so deleting a recipe silently removes it from planned menus once W9+ menus exist. Nothing in W6 breaks; recorded here for the W9 plan.

#### 12.2.6 GAP, LOCKED (D4) — `role`, `cuisineTier1` and `dietaryTags` are closed GraphQL enums over unconstrained SQL

`recipes.cuisine_tier1` is plain `TEXT` with no `CHECK`; `dietary_tags` is `JSONB DEFAULT '[]'` with no shape constraint. The SDL types them as `CuisineTier1` and `[DietaryTag!]!` — closed enums. `role` alone is DB-constrained (`CHECK (role IN (...))`, matching `RecipeRole` exactly).

This is **not** the same situation as §11.2.4's pantry `unit`/`category` (plain `String` on the wire, so an unrecognised value passes through harmlessly). Here, an unrecognised persisted value makes **AppSync fail to serialize the entire `Query.recipes` response** — the whole Library errors because one row is bad. Realistic sources: W7's AI freeform parse, W7's URL import, W13/14's hand-authored curated JSON, W19's cook-from-pantry save.

**Locked (D4): reject, don't pass through.** `api/src/domain/recipeRoles.ts`, `cuisineTiers.ts`, `dietaryTags.ts` (the `pantryUnits.ts`/`pantryCategories.ts` file pattern, opposite failure mode) — normalise then reject. Case/whitespace normalisation and a small alias map on the way in; an unknown value is a `ValidationError` at the resolver boundary, never persisted. The migration additionally adds a `CHECK` on `cuisine_tier1` as a DB-level backstop (a deviation from SD §7.1's DDL → `doc-updater` trigger).

On read, if a row somehow already holds an invalid value (hand-inserted, or a future bug): coerce `cuisineTier1` to `null` and drop unknown `dietaryTags` entries, logging a warning — one bad row degrades one field, never the whole query. `role` can't be coerced (`RecipeRole!`, non-null), but the SQL `CHECK` makes an invalid stored `role` unreachable.

#### 12.2.7 GAP, LOCKED (D5) — `Query.recipes` would otherwise return unbounded recipes with fully-hydrated ingredients

`Recipe.ingredients` is `[RecipeIngredient!]!` — non-null, so a naive implementation hydrates every ingredient of every recipe on every Library open. At R7's 280–300-recipe scale (~10 ingredients each), that's a ~3,000-row join for a card (`RecipeCard`) that shows only a title, role, time, and a favorite star.

**Locked (D5):** a separate `Recipe.ingredients` **field resolver**, the same pattern `User.households` already uses (`api/src/resolvers/userHouseholds.ts`, wired via `{ typeName: 'User', fieldName: 'households' }` in `api-stack.ts`'s `DB_RESOLVERS`). The Library's Ferry operation does not select `ingredients`; the Detail screen's does. No SDL type change — only the wiring.

Separately: `Query.recipes` gets a deterministic `ORDER BY` (`is_favorite DESC, LOWER(title)`) — PRD §7.1 says "favorites and rotation surfaced first." **Pagination is deliberately not added in W6** unless S9's spike says otherwise (D9).

#### 12.2.8 GAP — `recipes` has no `updated_at`, `Recipe` exposes no `createdAt`/`updatedAt`

`pantry_items` carries `added_at` + `updated_at`; `recipes` carries only `created_at`, and the GraphQL type exposes neither. **Locked as part of D3:** the W6 migration adds `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` (set by `updateRecipe`/`favoriteRecipe`/`setInRotation`, the `updatePantryItem` pattern), and the SDL exposes `createdAt: AWSDateTime!` / `updatedAt: AWSDateTime!` on `Recipe`. Both are SD deviations → `doc-updater` triggers. `created_by` is *not* exposed (no wireframe shows it, small privacy surface for no product benefit yet).

#### 12.2.9 GAP, LOCKED (D6) — `onRecipeChanged` ships in W6, not deferred

SD §6.1's `Subscription` type had four fields (`onPantryChanged`, `onMenuChanged`, `onShoppingListChanged`, `onHouseholdChanged`) and none for recipes, despite recipes being household-shared and editable by any member (favoriting is explicitly household-level per PRD §7.1). The planner recommended deferring to W8; **the founder chose to build it in W6 instead (D6)** — this is slice **S11** below, and it makes W6 two-device-verifiable the way W5 was, using the same `RUNBOOK.md` §3 procedure.

Mechanically cheap after W5 S8: the multiplexed `AppSyncSubscriptionClient` + `appsync_websocket_link.dart` are already generic over any subscription, the per-field authorization resolver pattern is established (§11.2.9), and §11.2.12's "every push means refetch" decision means the client side is a `Stream<void>` + one `_refetch()` — the same ~10 lines `PantryController` already has.

#### 12.2.10 NOTE — "duplicate" is in the PRD and in no sprint week

`PRD.md` §7.1 lists recipe actions as "Edit / delete / **duplicate**." Not in SD §6.1's mutation list, not in any sprint week. **Call:** not built in W6 — it's a locked-SDL change for a convenience action whose primary use case (duplicating a curated recipe) doesn't exist until W14. Founder should schedule it (W14 is the natural place) or move it to v1.1 explicitly; recorded here so it isn't silently dropped.

#### 12.2.11 NOTE — recipe cover images are in the storage design and in no week

SD §8 reserves `recipe-images/{recipeId}.jpg` with a CloudFront-fronted presigned-URL upload path. No `Recipe` SDL field references an image, no week schedules it, no wireframe shows an image slot. **Call:** treated as descoped from MVP; `RecipeCard` (S6) is designed without an image slot. Flagged so a later week doesn't "discover" it as a requirement.

#### 12.2.12 NOTE, LOCKED (D7) — Drift caching for recipes → W14

SD §9.1 and the Phase 2 exit criteria mention the Drift read-cache only for pantry. No week originally scoped a recipes cache, despite the recipe library arguably being the stronger offline case (a 50–300-item reference browsed with bad signal, vs. a pantry mostly edited at home). Two real complications beyond a copy of W5's S7: recipes have a **child table** (two Drift tables + a join, or one table with a serialized ingredients column), and the cache-write invariant (only the unfiltered fetch may `replaceAll`) gets harder with two filter dimensions (`role`, `isFavorite`). **Locked (D7): W14** — when 300 real curated recipes exist and offline browsing genuinely matters, and after D9's perf-spike result (a cached library changes what the scroll benchmark measures) is known.

#### 12.2.13 NOTE, forward-flag — `recipes.created_by` is `NOT NULL REFERENCES users(id)`, and W14 seeds curated rows

Curated-library seeding (locked as "copy rows on `createHousehold`" elsewhere) needs every copied row to satisfy the `created_by` FK. There is no system user. W14 will have to use the household creator's id or add a sentinel user row. Nothing in W6 changes; recorded so W14 doesn't hit a `NOT NULL` wall mid-slice.

#### 12.2.14 NOTE — `idx_recipes_role` does not serve W6's actual query

SD §7.1 creates `idx_recipes_role ON recipes(household_id, role) WHERE in_rotation = TRUE` — a partial index built for W10's auto-fill, not W6's `Query.recipes(householdId, role, isFavorite)` (no rotation predicate). **Call:** create both indexes exactly as SD §7.1 specifies; `idx_recipes_role` is deliberately unused until W10, recorded so a future reader doesn't "fix" it.

#### 12.2.15 NOTE — `drink` role exists but is out of planning scope

PRD §7.1: "`drink` — beverages (post-MVP scope for planning, but role exists)." **Call:** W6 accepts `drink` everywhere the other six roles are accepted; nothing to build, recorded so "post-MVP" next to a shipped enum value doesn't invite a wrong deletion later.

#### 12.2.16 CONFLICT, minor — `setInRotation`'s week was ambiguous between the original W6 and W10 rows

The original §4 W6 row said "favorite + rotation flags" and the W10 row said "`setInRotation` mutation." **Call (reflected in §4 already):** the mutation ships W6 (S5, below — it's a recipe-library toggle in the W6 Overflow menu); W10's row now reads "consumes `setInRotation` in `autoFillWeek`."

### 12.3 Slice breakdown

Eleven slices, one PR each. **S8 is committed** (D2 = Option B, not conditional). **S11 is new** (D6 — `onRecipeChanged`, not in the planner's original draft, added after founder sign-off).

#### S1 — `recipes` + `recipe_ingredients` migration, RLS on both, grants

- **Delivers:** both tables per SD §7.1 DDL, both specified indexes (§12.2.14), plus three W6 deviations: `recipes.updated_at` (§12.2.8), a `CHECK` on `cuisine_tier1` (§12.2.6), and RLS on `recipe_ingredients` (§12.2.2). `ENABLE` + `FORCE` on both tables, `FOR ALL USING ... WITH CHECK ...` on both, explicit `parimaan_app` grants on both. No GraphQL, no app code.
- **Files:** `api/migrations/<ts>_recipes.ts` (new; grants go in the *new* migration, not the applied `app-role` one — §11.2.3's lesson). `1787670947641_pantry-items.ts` is the pattern to copy comment-for-comment.
- **Depends on:** nothing. Can start immediately.
- **Size / Risk:** ~2.0 hrs / **Medium-High** — two tables, one with a parent-join RLS policy that has no precedent in this codebase and is the week's highest-value test surface.
- **Agents:** `tdd-guide` → `database-reviewer` (mandatory on every migration) → `security-reviewer` (fires: SQL migration + RLS policy) → `code-reviewer`.
- **RED tests** (real Testcontainers Postgres, §3.2): member SELECTs only own-household recipes; **non-member SELECT on `recipe_ingredients` by `recipe_id` directly returns zero rows** (the §12.2.2 gap — the single most important test in this slice); non-member INSERT into `recipes` rejected; non-member INSERT into `recipe_ingredients` referencing another household's recipe rejected by `WITH CHECK`; non-member UPDATE/DELETE affect zero rows on both tables; `ON DELETE CASCADE` from `recipes` removes ingredients; `parimaan_app` can CRUD both tables; `role` CHECK rejects an unknown role; `cuisine_tier1` CHECK rejects an unknown cuisine and accepts `NULL`; `down()` clean and re-runnable.
- **Gate:** all green; both reviewers clean; deployed to real dev AWS and the migration runner ran it (not synth).

#### S2 — Recipe SDL + domain enums + `Query.recipes` + `Recipe.ingredients` field resolver

- **Delivers:** `RecipeRole`, `RecipeSource`, `Recipe`, `RecipeIngredient`, `RecipeInput`, `RecipeIngredientInput`, `RecipePatchInput` in `shared/schema.graphql` (first recipe SDL in the repo); the three canonicalisation/rejection domain modules (§12.2.6); repository + mapper + Zod; `Query.recipes` and the `Recipe.ingredients` field resolver (§12.2.7); two `DB_RESOLVERS` entries.
- **Files:** `shared/schema.graphql`; `api/src/domain/{recipeRoles,cuisineTiers,dietaryTags}.ts`; `api/src/repositories/recipeRepository.ts`; `api/src/mappers/recipe.ts`; `api/src/validation/recipes.ts`; `api/src/resolvers/{recipes,recipeIngredients}.ts`; `infra/stacks/api-stack.ts`.
- **Depends on:** S1.
- **Size / Risk:** ~2.5 hrs / **Medium** — resolver follows the well-worn `pantry.ts` path; new parts are the field resolver (precedent: `userHouseholds.ts`) and three enum modules.
- **Agents:** `tdd-guide` → `typescript-reviewer` → `security-reviewer` (fires: new Lambda resolvers + SQL construction) → `code-reviewer` → `doc-updater` (SDL change → re-sync SD §6.1; record §12.2.6/§12.2.8 deviations in SD §18).
- **RED tests:** non-member → denial on `Query.recipes`, identical to a nonexistent `householdId`; **`Recipe.ingredients` for a recipe in another household returns empty, not an error and not data** (the field resolver has no `householdId` arg to gate on — RLS is the only guard, the `findPantryItemById` situation); Zod rejections (blank title, unknown role, unknown cuisine, unknown dietary tag, invalid `servings`, over-long strings); `role`/`isFavorite` filters, individually and combined; **`.nullish()` not `.optional()` on every nullable arg** (the W5 §11.5.5 production bug — this is the first slice written after it was found); deterministic `ORDER BY` asserted; ingredient `sort_order` round-trips as array order.
- **Gate:** ≥80% coverage; `pnpm -r` regenerates Ferry/TS clients with a clean tree; deployed to dev AWS and queried for real.

#### S3 — `createRecipe`

- **Delivers:** `Mutation.createRecipe(householdId, input: RecipeInput!): Recipe!` — parent row + N ingredient rows in one transaction, `sourceType` server-set to `user`, `createdBy` from verified caller identity, `sortOrder` from array index, `inRotation` defaulting TRUE, **`role` required with no default** (the DoD gate's actual enforcement point, D1).
- **Files:** `api/src/resolvers/createRecipe.ts`; `api/src/validation/createRecipe.ts`; `recipeRepository.ts` (insert + bulk ingredient insert); `api-stack.ts`.
- **Depends on:** S2.
- **Size / Risk:** ~2.0 hrs / **Medium** — transaction with a child table is new (`bulkAddPantryItems` is the nearest rollback-shape precedent). **Cap ingredients and steps** (proposed 100 ingredients, 100 steps, 2000 chars/step) against unbounded-list resource exhaustion.
- **RED tests:** non-member denied; missing `role` → `VALIDATION` (**the gate test — assert it by name**); unknown role/cuisine/dietary rejected, not coerced; `sourceType` cannot be set from input; `createdBy` is the caller, never input; over-cap ingredients → `VALIDATION`; **rolls back entirely when ingredient *k* fails**; empty ingredients list **allowed** (a recipe with no ingredients listed is real); zero steps allowed.

#### S4 — `updateRecipe` + `deleteRecipe`

- **Delivers:** `updateRecipe(id, input: RecipePatchInput!): Recipe!` with §12.2.4's mixed semantics (scalars patch, `ingredients`/`steps` replace-whole-list-when-present), and `deleteRecipe(id): Recipe!` per §12.2.5. Neither takes `householdId` — discovered from `id` through an RLS-scoped query (the `updatePantryItem`/`deletePantryItem` pattern).
- **Depends on:** S3.
- **Size / Risk:** ~1.5 hrs / **Low-Medium**.
- **RED tests:** update/delete in another household denied identically to a nonexistent id (never an existence oracle); partial patch leaves absent scalars unchanged and rejects explicit `null`; `ingredients: []` explicitly clears (distinct from absent — assert both); ingredient replace is transactional; `updated_at` moves; `deleteRecipe` returns the deleted row and a second call denies; deleting a recipe cascades its ingredients.

#### S5 — `favoriteRecipe` + `setInRotation`

- **Delivers:** the two flag mutations, both single-column updates returning the full `Recipe!`. Ships W6 (§12.2.16); W10 consumes it.
- **Depends on:** S2.
- **Size / Risk:** ~1.0 hr / **Low**.
- **RED tests:** non-member denied identically to nonexistent; idempotent; `favorite: false` un-favorites; `updated_at` moves; both are household-level not per-user (assert a second member sees the flag).

#### S6 — Recipes tab + Library screen + `RecipeCard`

- **Delivers:** a third `StatefulShellBranch` in `router.dart` at `/home/recipes` through the existing `PTabBar`; wireframe 7.1; the **`RecipeCard`** domain widget; role filter chips + favorites filter driving server-side `role`/`isFavorite` params; empty/loading/error states via `PEmptyState`.
- **Files:** `mobile/lib/app/router.dart`; `mobile/lib/features/shell/presentation/app_shell.dart`; `mobile/lib/shared/graphql/operations/recipes.graphql` + regenerated `__generated__/`; `mobile/lib/features/recipes/domain/{recipe,recipe_role,recipe_source,recipe_ingredient}.dart`; `.../data/{recipe_repository,recipe_mapper}.dart`; `.../state/recipe_library_controller.dart`; `.../presentation/{recipes_library_screen,recipe_card,recipes_error_copy}.dart`.
- **Depends on:** S2 (query only).
- **Size / Risk:** ~2.5 hrs / **Medium** — mirror `features/pantry/` layer-for-layer. `RecipeCard` has no image slot (§12.2.11). The Library operation deliberately does not select `ingredients` (§12.2.7) — assert this in a test.
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`. `security-reviewer` skips (presentation + a read path over an already-reviewed resolver).
- **RED tests:** family provider scoped by `householdId` emits `loading → data`; errors surface via `graphql_error_mapper.dart`; role-chip selection refetches server-side (no client-side filtering — breaks at 300 items); failed refetch keeps last good list; `RecipeCard` renders title, role, total time (nullable `prepMin`/`cookMin`, test the all-null case), favorite indicator, rotation indicator; Library query document does not contain `ingredients`; `/home` shows a three-item `PTabBar`; branch state preserved across tab switches; deep-link while signed out bounces to `/sign-in`; existing W5 router/shell tests pass except the tab-count assertion.

#### S7 — Recipe Detail + Overflow menu

- **Delivers:** wireframes 7.2/7.3. Detail selects `ingredients` (the field resolver's W6 consumer) and steps. Overflow menu: Toggle favorite → `favoriteRecipe`; Toggle rotation → `setInRotation`; Delete → confirm dialog → `deleteRecipe`; Edit → present (D2 = B ships S8, so Edit is always shown this week).
- **Files:** `mobile/lib/features/recipes/presentation/{recipe_detail_screen,recipe_overflow_menu,delete_recipe_dialog}.dart`; `.../state/recipe_detail_controller.dart`; routes.
- **Depends on:** S4, S5, S6.
- **Size / Risk:** ~2.0 hrs / **Medium** — no optimistic update on flag toggles; invalidate the library provider on success (`PantryFormController`'s `ref.invalidate` pattern).
- **RED tests:** detail renders ingredients + steps in `sort_order`; zero-ingredient recipe renders without crashing; overflow toggles call the right mutation and invalidate the library; delete requires confirm, cancel is a no-op; delete pops back to Library, row is gone; server `FORBIDDEN`/`NOT_FOUND` renders as copy, not a crash.

#### S8 — Structured create/edit form

- **Delivers:** wireframe 8.2, pulled forward from W7 (D2), used for both create and edit (the §11.2.7 seeded-form reuse pattern). **Role is required with no pre-selection** — where "role assignment required" becomes visible to a user (D1).
- **Files:** `mobile/lib/features/recipes/presentation/{recipe_form_screen,recipe_form_entry,ingredient_row_editor,step_row_editor}.dart`; `.../state/recipe_form_controller.dart`; `.../domain/{recipe_draft,recipe_patch,recipe_validation}.dart`; routes.
- **Depends on:** S3, S4, S7.
- **Size / Risk:** ~2.5 hrs / **Medium-High** — highest-uncertainty Flutter slice: a *dynamic-length list* form (add/remove/reorder ingredients and steps), which nothing in this codebase has built yet. Mitigation: pure-Dart validators in `features/recipes/domain/`, unit-tested against the same case table as the Vitest suite.
- **RED tests:** submit disabled until title + role + valid ingredients; role picker has no default, blocks submit until chosen; add/remove ingredient rows preserves other rows' values; reorder updates submitted array order; edit mode seeded from the existing recipe, unchanged scalars not sent; edited ingredient list sends the *whole* list (replace semantics, tested explicitly); server `VALIDATION` renders inline; cancel mutates nothing.

#### S9 — R7 perf spike: 300-recipe library scroll on a low-end Android

- **Delivers:** the §6 R7 spike, executed and written up with real numbers. Spikes are exempt from strict TDD (`DEV_WORKFLOW.md` §6c) — measurement, not tested production code.
- **Method:** (1) seed a real dev household with 300 recipes with realistic title lengths and 10–15 ingredients each (§12.5.3 — not `Recipe 001`, so the number is comparable at a W14 re-run) via a throwaway script or direct SQL, not committed as production code; (2) build in **profile mode** (never debug) on the lowest-end physical Android available; (3) scroll the Library end-to-end three times, capture frame timings via DevTools; record **p50/p99 frame build+raster times, count of frames >16ms/>32ms, jank percentage, time-to-first-paint**; (4) separately record the **payload** `Query.recipes` returns for 300 recipes — bytes and wall-clock.
- **Pass/fail:** target <5% of frames over 16ms, no frame over 100ms during steady scroll, Library time-to-first-paint under 1.5s on a **warm** backend (Aurora auto-pause would otherwise contaminate the number — §12.5.4).
- **If it fails:** verify `ListView.builder` recycling (should already hold from S6 — verify, don't assume) and add **pagination to `Query.recipes`** — an SDL change, cheaper now (one consumer) than at W10 (picker sheet) or W14 (curated seed).
- **Depends on:** S6 (needs a real Library to scroll). Runs right after S6 (D9), before S7/S8, so a pagination finding doesn't force rework of already-built screens.
- **Size / Risk:** ~1.5 hrs / **Medium** — risk is device availability, not technical. Named fallback (D9): lowest-end physical Android on hand, exact device/SoC recorded, result treated as an upper bound. A simulator/emulator run is not a substitute.
- **Agents:** none mandated (spike). `doc-updater` records the result.

#### S11 — `onRecipeChanged` subscription (D6 — pulled forward from a planner-recommended W8)

- **Delivers:** `Subscription.onRecipeChanged(householdId)`, per-field authorization resolver (§11.2.9's pattern — same security property as an API-level authorizer, far less machinery), wired into the existing multiplexed `AppSyncSubscriptionClient` (generic since W5 S8). `RecipeLibraryController` and `RecipeDetailController` subscribe and refetch on push — the "every push means refetch" decision (§11.2.12), a `Stream<void>` + `_refetch()`, mirroring `PantryController`.
- **Files:** `shared/schema.graphql` (`Subscription.onRecipeChanged`); `api/src/resolvers/onRecipeChanged.ts` (or the equivalent field-authorizer wiring `onPantryChanged.ts` used); `infra/stacks/api-stack.ts`; `mobile/lib/features/recipes/state/{recipe_library_controller,recipe_detail_controller}.dart`; `mobile/lib/shared/graphql/operations/recipes.graphql` (subscription op).
- **Depends on:** S2 (SDL), S3/S4/S5 (mutations to fan out from).
- **Size / Risk:** ~1.5 hrs / **Low-Medium** — the mechanism is proven (W5 S8); risk is limited to wiring, not design.
- **Agents:** `tdd-guide` → `security-reviewer` (fires: subscription authorization) → `flutter-reviewer` (client side) → `code-reviewer`.
- **RED tests:** non-member's subscribe attempt rejected (test, not inspection — the §11.6 W5 precedent); a create/update/delete/favorite/rotation change on one client triggers a refetch on a second subscribed client; disconnect/reconnect resubscribes (reuses W5 S8's connection-lifecycle tests as a template, since three real bugs were caught there — a hang, a poisoned client, a use-after-cancel crash — the same test shapes apply here).

#### S10 — Real-AWS verification + two-device sync + weekly doc pass

- **Delivers:** every W6 backend slice exercised against the real dev stack (`RUNBOOK.md` §2's non-negotiable) — `cdk deploy Parimaan-dev-Data Parimaan-dev-Api`, confirm the migration runner applied the recipes migration, then drive create → read → favorite → rotate → edit → delete from a real signed-in device against real AppSync/Aurora, including at least one call with an **explicit `null`** for every nullable argument (the exact shape of the W5 §11.5.5 bug). Plus **`RUNBOOK.md` §3's two-device verification procedure, re-run for `onRecipeChanged`** (D6 makes this applicable this week, unlike the planner's original draft which assumed no W6 subscription) — add/edit/delete on Device A appears on Device B, timed, target <5s, following the identical honesty standard set in W5 §11.5.5 (no fabricated stopwatch numbers if precision can't be certified). Plus §4.2's mandatory weekly pass: actual-vs-planned hours into §4's W6 row, and S9's spike result.
- **Files:** `docs/E2E_MVP_PLAN.md` (§4 W6 actuals + this §12); `docs/SYSTEM_DESIGN.md` (§6.1 SDL re-sync; §7.1 DDL deviations; §18 for the enum-rejection decision); `docs/RUNBOOK.md` (any new real-deploy bugs, in the §2 pattern).
- **Depends on:** S5, S7, S8, S9, S11.
- **Size / Risk:** ~1.0 hr / **Low** risk, non-optional — a week isn't done until its §4 row has actuals.
- **Agents:** `doc-updater`. `security-reviewer` phase-boundary sweep does not fire this week (W6 is not a §2.3 boundary week); per-slice triggers still fire on S1, S2, S3, S4, S5, S11.

### 12.4 Sequencing

```
        can start immediately, in parallel
        ┌───────────────────────────────────────────────┐
   ┌────▼──────────────────┐                            │
   │ S1 recipes +          │                     (nothing Flutter-side
   │ recipe_ingredients    │                      is zero-dependency this
   │ migration + RLS x2    │                      week — S6 needs S2's
   └────┬──────────────────┘                      SDL to codegen against)
   ┌────▼──────────────────┐
   │ S2 SDL + enums +      │
   │  Query.recipes +      │
   │  Recipe.ingredients   │
   └────┬───────────┬──────┘
        │           └──────────────────────────┐
   ┌────▼──────────┐   ┌──────────────────┐    │
   │ S3 createRecipe│   │ S5 favorite +   │    │
   └────┬──────────┘   │   setInRotation  │    │
   ┌────▼──────────┐   └────────┬─────────┘    │
   │ S4 update +   │            │      ┌───────▼──────────────┐
   │    delete     │            │      │ S6 Recipes tab +     │
   └────┬──────────┘            │      │  Library + RecipeCard│
        │                       │      └───┬──────────────┬───┘
        │        ┌──────────────┘          │              │
        │  ┌─────▼───────────────▼─────────▼──┐    ┌──────▼─────────────┐
        │  │ S11 onRecipeChanged subscription  │    │ S9 R7 perf spike   │
        │  └─────┬──────────────────────────────┘    │  (300 items)       │
        │  ┌──────▼────────────────────────────┐    └──────┬─────────────┘
        └─►│ S7 Detail + Overflow menu          │           │
           └─────────────┬────────────────────┘           │
           ┌─────────────▼────────────────────┐           │
           │ S8 Structured form                │           │
           └─────────────┬────────────────────┘           │
                  ┌───────▼───────────────────────────────▼┐
                  │ S10 real-AWS + two-device verification  │
                  │    + doc pass                           │
                  └──────────────────────────────────────────┘
```

**Working order: S1 → S2 → S6 → S3 → S4 → S5 → S9 → S11 → S7 → S8 → S10.**

Non-obvious choices, with rationale:

- **S6 immediately after S2, before the write mutations.** Nothing Flutter-side can start before the SDL exists (Ferry codegen needs it). Getting a real Library screen on screen early is what makes S9's spike possible before the week is over, and gives visible progress in week 1 of a two-week W6.
- **S9 before S7/S8, not last.** S9's only dependency is S6, and its worst-case outcome is an SDL change (pagination). Discovering that after S7/S8/S11 are built means reworking multiple slices. Same reasoning as W5's "S8 before S7" — do the risk-relevant slice first.
- **S11 before S7/S8.** The Detail/Overflow/Form screens are more useful to build and test against a library that's already syncing in real time, and S11 only needs S2–S5, not S6's UI.
- **S5 before S9/S11 but after S3/S4.** S5 is trivially small and can run while S3/S4 sit in review.

### 12.5 Risks

#### 12.5.1 The week does not fit in 10 hours — locked and accepted (D8)

| Slice | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S11 | S10 | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hrs | 2.0 | 2.5 | 2.0 | 1.5 | 1.0 | 2.5 | 2.0 | 2.5 | 1.5 | 1.5 | 1.0 | **20.0** |

Against ~10 hrs nominal, a **100% overrun before any surprise** — worse than §11.5.1 flagged for W5 (which itself then overran further on two slices, §11.5.5). §11.7 Q5 already spent ~8 of the §7 plan's 20-hr buffer on W5. **Locked (D8): accept a two-week W6.** Phase 2 (W5–W8) is now effectively ~6 calendar weeks; the buffer will be essentially gone by W8, and every subsequent slip pushes the MVP date directly. Phase 3 remains flagged as a stretch phase (§7).

#### 12.5.2 The `recipe_ingredients` RLS policy is the week's highest-severity item

A genuine data-leak surface (§12.2.2) in a table with no `household_id`, protected by a policy pattern with no precedent in this repo, sitting under a field resolver (`Recipe.ingredients`) with **no `householdId` argument to gate on** — layer 2 (`requireHouseholdMember`) cannot run there at all, so RLS is genuinely load-bearing, not defense-in-depth. Both S1 and S2 must test this directly; `security-reviewer` fires on both.

#### 12.5.3 R7 may return a result nobody wants to act on

If S9 says the list is slow, the fix (pagination) is an SDL change plus rework of S6 mid-week. If S9 says it's fine, the number may be unrepresentative — 300 synthetic recipes with short titles and no images vs. W14's real library with long titles and W19's AI-generated ones. **Mitigation:** seed with realistic title lengths and 10–15 ingredients, not `Recipe 001`; record the seed characteristics alongside the numbers so a W14 re-run is comparable.

#### 12.5.4 Real-AWS verification cost, and the two W5 bug classes that will recur

Every backend slice needs a real dev deploy. Two specific recurrences to pre-empt: **`.optional()` vs `.nullish()`** on every nullable Zod field (`Query.recipes` has two nullable args; `RecipeInput`/`RecipePatchInput` have many — S2/S3/S4's tests must exercise explicit `null`, not only absent keys); and **Aurora auto-pause cold start** (~30s on first request after a pause) — S9's time-to-first-paint measurement must be taken against a **warm** backend or the number measures Aurora, not Flutter.

The Lambda concurrency quota increase remains filed and pending (real ceiling: 10). W6 adds ~7 more DB-backed resolver Lambdas to `DB_RESOLVERS`, taking the total well past 15 — nothing in W6 *depends* on the quota landing (a single dev user invokes serially), but S9's spike (300 recipes seeded via repeated `createRecipe` calls) is the most likely thing to hit it. Seed via direct SQL if the script throttles.

#### 12.5.5 S9 result — exploratory emulator run, NOT the recorded D9 spike

No physical Android device was available when S9 ran. Per D9's own fallback language ("no simulator/emulator substitution"), this is **not** the recorded spike result — the exit-criteria box below stays unchecked pending a real low-end device. What follows is an exploratory pass, run to get early signal rather than to close the gap.

**Setup:** an Android Studio emulator (`Redmi_Class_API34`, Android 14/API 34, arm64-v8a) was set up on the dev Mac, hardware profile hand-tuned toward a budget device (720×1600 @ 270dpi, 3GB RAM, 4 cores — the AVD's own default profile is a placeholder 320×640 QVGA screen, not representative of anything). This runs on the Mac's own Apple Silicon GPU/CPU, not real budget-Android silicon — the number below characterizes whether `RecipeCard`/`ListView.builder` recycling holds up structurally, not real-world frame cost on weak hardware.

**Seed (method step 1):** 300 recipes (10–15 ingredients each, realistic dish names/qualifiers, not `Recipe 001`) created in a throwaway "S9 Perf Spike Household" on real dev AWS via direct `createHousehold`/`createRecipe` Lambda invokes (a throwaway Node script, not committed — direct SQL wasn't needed; `CONCURRENCY=8` stayed under the account's 10-execution Lambda ceiling §12.5.4 flagged as the risk). 300/300 succeeded, 0 failures, ~29s wall-clock.

**Payload/wall-clock (method step 4):** `Query.recipes` for the 300-recipe household, invoked directly against the real `RecipesFn` Lambda (dev Aurora, warm — §12.5.4's auto-pause caveat doesn't apply to a direct Lambda invoke the same way it would to a cold first mobile request, but the backend was not freshly resumed either way): **283,250 bytes**, **~0.68s** wall-clock on a warm invoke (first invoke 1.85s, cold-start-inflated).

**Scroll perf (method step 3):** an `integration_test` fling-scroll (three passes, forward+back) over `RecipesLibraryScreen` seeded with 300 synthetic `Recipe` objects (no network — isolates the render cost from the already-measured network cost above), captured via `IntegrationTestWidgetsFlutterBinding.traceAction` + `TimelineSummary`, `flutter drive --profile`:

- First run used the AVD's default `hw.gpu.enabled=no` (software/SwiftShader rendering) — 158/242 frames (65%) missed the 16ms raster budget, p99 raster 45.9ms. Discarded: this measures the software rasterizer, not anything resembling GPU-accelerated rendering on any real device, weak or otherwise.
- Re-run with `hw.gpu.enabled=yes` / `hw.gpu.mode=host` (real host-GPU passthrough): **0/262 frames missed either the build or the raster budget.** Build: avg 0.56ms, p99 1.95ms, worst 3.23ms. Raster: avg 3.28ms, p99 8.64ms, worst 11.7ms. Jank percentage: 0%.

**Reading this:** the 0%-jank number is a real result for *this* run, not a fabricated one — but it answers "does the widget tree recycle correctly at 300 items," not "is this fast enough on a Redmi." §12.5.3's own warning applies in the other direction here too: a clean emulator pass, on host-GPU-accelerated hardware vastly faster than a budget phone's, is exactly the kind of number that "may return a result nobody wants to act on" if mistaken for the real spike. No jank at this scale is consistent with `.builder`-backed recycling doing its job (the thing S9's own fallback section says to verify first if the real spike fails) — it does not clear D9's bar. Exit-criteria box stays open.

**Cleanup:** the throwaway `integration_test`/`test_driver` harness and the temporary `integration_test` pubspec dependency were removed after the run (`git status` clean, confirmed) — not committed, per S9's own spikes-are-exempt-from-TDD, throwaway-script convention. The seeded "S9 Perf Spike Household" (300 recipes) was left in dev Aurora rather than torn down, for a possible re-run once a physical device is available; it's clearly named and isolated to its own household, no cost/risk to leaving it.

### 12.6 W6 exit criteria

- [x] `recipes` and `recipe_ingredients` on dev with RLS **enabled and forced on both**, policies covering `USING` **and** `WITH CHECK`, `parimaan_app` grants on both — verified by wrong-household tests for read, insert, update, delete, **including a direct `recipe_ingredients` read by `recipe_id`** (S1, `#40`)
- [x] `recipes.updated_at`, the `cuisine_tier1` CHECK, and the `recipe_ingredients` RLS line reflected in SD §7.1 with rationale (S1/S2 — deferred from S1's own PR, closed here; SD §18 decisions log also updated)
- [ ] All five recipe mutations + `Query.recipes` + `Recipe.ingredients` live on dev, each member-gated (or RLS-gated, for the id-only and field resolvers), each with a non-member denial test (S2–S5)
- [ ] `role` is required on create with no default; a `createRecipe` missing `role` fails `VALIDATION` — the DoD gate's "role assignment required", asserted by a named test (S3, D1)
- [ ] Unknown `role`/`cuisineTier1`/`dietaryTag` values are **rejected, not passed through**, at both the resolver and the DB `CHECK` (S2/S3, D4)
- [ ] Every nullable argument tested with an explicit `null`, not only an absent key (§11.5.5's regression, all backend slices)
- [ ] `shared/schema.graphql` gains the recipe SDL and is re-synced into SD §6.1, including `RecipeInput`, `RecipePatchInput`, and `deleteRecipe: Recipe!` (D3)
- [x] `/home` is a **three**-tab shell; existing W5 router/shell tests pass unmodified except the tab-count assertion (S6)
- [ ] Wireframes 7.1, 7.2, 7.3, **8.2** shipped → **22/49** (S6/S7/S8, D2) — 7.1 done (S6); 7.2/7.3/8.2 pending S7/S8
- [x] `RecipeCard` built and covered; the Library GraphQL document provably does not select `ingredients` (S6, D5)
- [ ] Favorite and rotation toggles work from the Overflow menu and are visible to a second member (S5/S7)
- [ ] Create and edit both work end-to-end through the structured form, role required with no pre-selection (S8, D2/D1)
- [ ] `onRecipeChanged` fans out add/update/delete across two devices — **two-device sync verified per `RUNBOOK.md` §3**, timed, target <5s, same honesty standard as W5 §11.5.5 (S11/S10, D6)
- [ ] **R7 spike run and written up with real p50/p99 frame numbers and a payload size** (S9, D9)
- [ ] Coverage: Lambda ≥80% (enforced in CI since W5); Flutter domain+state ≥80%
- [ ] `security-reviewer` clean on S1–S5 and S11 (per-slice triggers; no phase-boundary sweep this week)
- [ ] Every backend slice verified against real dev AWS, not synth — including a full create → favorite → rotate → edit → delete round trip from a real device (S10)
- [ ] §4's W6 row has actual hours (per-slice wall-clock) and carry-over notes
- [ ] §4's W10 row corrected to "consumes `setInRotation`" (already reflected — §12.2.16)

### 12.7 W6 planning decisions (final, locked 2026-08-26)

| # | Question | **Locked decision** |
|---|---|---|
| D1 | §12.2.1 — is `RecipeRole` the meal-slot role, and does "role assignment required" mean no default anywhere (server or UI)? | **Yes to both.** Meal-slot categorization (breakfast/carb/sabzi_dal/accompaniment/snack/sweet/drink), unrelated to `HouseholdRole`. Required on create, no server default, no pre-selected UI chip. |
| D2 | §12.2.1 — "Recipe CRUD complete" has no create/edit screen in W6's original budget: reword the gate, or pull wireframe 8.2 forward from W7? | **Pull forward (Option B).** +2.5 hrs (S8). Screen count 22/49 this week; W7's cumulative count unaffected. |
| D3 | §12.2.3–§12.2.5, §12.2.8 — the SDL shape package: `RecipeInput`/`RecipeIngredientInput` with no client-supplied server fields; `RecipePatchInput`; `deleteRecipe: Recipe!`; `createdAt`/`updatedAt` + `recipes.updated_at`. | **Approve all four**, as drafted in §12.2.3/§12.2.4/§12.2.5/§12.2.8. |
| D4 | §12.2.6 — `role`/`cuisineTier1`/`dietaryTags`: reject unknown values, or pass through like W5's pantry units? | **Reject** — deliberate asymmetry with W5's §11.2.4 pantry decision, because these are closed GraphQL enums and a bad row breaks the entire `Query.recipes` response, not one field. |
| D5 | §12.2.7 — hydrate `Recipe.ingredients` via a separate field resolver, Library query not selecting it? | **Yes.** Uses the `User.households` field-resolver precedent; cheap now, expensive after W10's picker and W14's seed both become consumers. |
| D6 | §12.2.9 — `onRecipeChanged`: build in W6, schedule into W8, or accept no recipe sync in MVP? | **Build in W6** (S11, new slice, ~1.5 hrs) — against the planner's W8 recommendation. Makes W6 two-device-verifiable like W5. |
| D7 | §12.2.12 — Drift local cache for recipes: W6, W8, W14, or never in MVP? | **W14** — when 300 real curated recipes exist and offline browsing genuinely matters; also lets D9's spike result inform the cache design. |
| D8 | §12.5.1 — how to absorb ~20.0 hrs against ~10, with the §7 buffer already ~8 hrs down from W5? | **Accept a two-week W6**, same pattern as W5. Phase 2 (W5–W8) becomes ~6 calendar weeks; buffer essentially gone by W8. |
| D9 | §6 R7 / S9 — does the 300-item perf spike run in W6, and on what device? | **Run it in W6, right after S6.** Cost-asymmetry argument: the likely mitigation (pagination) is an SDL change, nearly free now and expensive from W10/W14 onward. Fallback if no Redmi-class device is on hand: lowest-end physical Android available, exact device/SoC recorded, result treated as an upper bound — no simulator/emulator substitution. |

---
