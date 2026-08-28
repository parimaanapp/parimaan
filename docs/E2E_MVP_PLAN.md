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
| **W7** | URL import + freeform AI parse **spike week** (locked as a multi-week sprint, §13.5.1/D9 — same pattern as W5/W6) | Choose method, URL import, Freeform input, Freeform review, AI failure fallback (27/49) | JSON-LD parser; `parseFreeformRecipe` via **Gemini 2.5 Flash** (D11 — scoped deviation from the Bedrock-everywhere assumption below, §13.2.2; Bedrock ap-south-1 spike **cut**, not run); Zod validation; **JSON-LD spike (top-20 blogs)**; AIProposal widget | ≥16/20 blogs parse; freeform AI returns valid JSON |
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
| R1 | Bedrock Claude unavailable in `ap-south-1` | Technical | Cross-region fallback to `us-east-1`; accept +150–250ms latency | **Moot for W7** (§13 D11 — W7's AI runs on Gemini instead, a scoped deviation; this row stays live only for a future week that revisits Bedrock) |
| R2 | JSON-LD Recipe schema coverage < 60% on Indian blogs | Technical | Copy-paste fallback UX in URL import screen; downgrade importance | **Resolved — 15/20 ld+json present, 14/20 usable draft** (§13 S1, §13.5.12). D10's middle tier fired: URL import ships, copy-paste promoted to equal prominence, not downgraded further. |
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

- **Delivers:** wireframes 7.2/7.3. Detail selects `ingredients` (the field resolver's W6 consumer) and steps. Overflow menu: Toggle favorite → `favoriteRecipe`; Toggle rotation → `setInRotation`; Delete → confirm dialog → `deleteRecipe`; Edit → present (D2 = B ships S8, so Edit is always shown this week). **Deviation, approved mid-slice:** the original plan text below assumed the Detail screen could read a single recipe via the existing `Query.recipes(householdId)`. It cannot — that query returns the whole household's list, no single-`id` accessor existed, and reusing it for Detail would re-fetch (and, once selecting `ingredients`, fully hydrate) every recipe in the household just to show one — the exact per-Library-open cost D5/§12.2.7 wrote the Library/Detail split to avoid, just relocated to Detail. Given the choice between that and a small backend addition, added `Query.recipe(id: ID!): Recipe!` — same `id`-only, RLS-gated pattern already established by `updateRecipe`/`deleteRecipe`/`favoriteRecipe`/`setInRotation`, reviewed clean by `security-reviewer`.
- **Files:** `mobile/lib/features/recipes/presentation/{recipe_detail_screen,recipe_overflow_menu,delete_recipe_dialog}.dart`; `.../state/{recipe_detail_controller,recipe_overflow_controller}.dart` (two controllers, not one — see RED tests); `.../data/{recipe_repository,recipe_mapper}.dart` (additions); `mobile/lib/shared/graphql/operations/{recipe_detail_fields,recipe_detail,favorite_recipe,set_in_rotation,delete_recipe}.graphql`; routes. Plus, for the `Query.recipe` deviation above: `shared/schema.graphql`; `api/src/resolvers/recipe.ts`; `api/src/repositories/recipeRepository.ts` (`findRecipeById`); `api/src/validation/recipes.ts` (`recipeArgsSchema`); `infra/stacks/api-stack.ts` (resolver/Lambda counts 24→25, VPC-attached 23→24).
- **Depends on:** S4, S5, S6.
- **Size / Risk:** ~2.0 hrs planned / **Medium** — no optimistic update on flag toggles; invalidate the library provider on success (`PantryFormController`'s `ref.invalidate` pattern). Actual scope grew beyond the plan's mobile-only estimate once the `Query.recipe` gap surfaced (a backend resolver + repository function + validation schema + infra wiring, all reviewed), so the ~2.0 hr figure understates this slice — noted here rather than silently absorbed.
- **RED tests:** detail renders ingredients + steps in order; zero-ingredient recipe renders without crashing; overflow toggles call the right mutation and invalidate the library; delete requires confirm, cancel is a no-op; a failed action does not blank the already-loaded recipe (the reason [setFavorite]/[setInRotation]/[delete] live in a separate `RecipeOverflowController`, not `RecipeDetailController` itself); a failed action on one recipe does not leak into another recipe's Overflow controller (`autoDispose.family`, not a bare singleton); server `FORBIDDEN`/`NOT_FOUND` renders as copy, not a crash; `Query.recipe`'s own backend suite: non-member/nonexistent-id denial identical to `NotFoundError` (no existence oracle), RLS actually scopes a bare `SELECT`, not just writes.

#### S8 — Structured create/edit form

- **Delivers:** wireframe 8.2, pulled forward from W7 (D2), used for both create and edit (the §11.2.7 seeded-form reuse pattern). **Role is required with no pre-selection** — where "role assignment required" becomes visible to a user (D1).
- **Files:** `mobile/lib/features/recipes/presentation/{recipe_form_screen,ingredient_row_editor,step_row_editor}.dart`; `.../state/recipe_form_controller.dart`; `.../domain/{recipe_draft,recipe_patch,recipe_ingredient_draft,recipe_validation}.dart`; routes. **Deviation:** `recipe_form_entry.dart` (named in the original plan) was not built. That file's job — the async fetch-then-hydrate adapter `household_wizard`'s screens use — has nothing to adapt here: unlike a wizard's incrementally-built draft provider, the recipe this screen edits is always already loaded in memory before Edit is reachable (only from an already-loaded Detail screen), the exact same shape `ManualAddScreen` was already built around. `RecipeFormScreen` takes `initialRecipe` directly (passed via route `extra`, mirroring `ManualAddScreen.initialItem`/pantry's `extra: PantryItem?`) instead.
- **Depends on:** S3, S4, S7.
- **Size / Risk:** ~2.5 hrs / **Medium-High** — highest-uncertainty Flutter slice: a *dynamic-length list* form (add/remove/reorder ingredients and steps), which nothing in this codebase has built yet. Mitigation: pure-Dart validators in `features/recipes/domain/`, unit-tested against the same case table as the Vitest suite.
- **RED tests:** submit disabled until title + role + valid ingredients; role picker has no default, blocks submit until chosen (and re-blocks if deselected); add/remove ingredient rows preserves other rows' values; reorder updates submitted array order; edit mode seeded from the existing recipe, unchanged scalars not sent; edited ingredient list sends the *whole* list (replace semantics, tested explicitly); server `VALIDATION` renders inline; cancel mutates nothing; submitting an edit with nothing changed sends no request and just pops (caught a real bug: constructing `RecipePatch` before checking "did anything change" trips its own at-least-one-field assert on exactly this no-op-save path — fixed by computing the changed-field set first).

#### S9 — R7 perf spike: 300-recipe library scroll on a low-end Android

- **Delivers:** the §6 R7 spike, executed and written up with real numbers. Spikes are exempt from strict TDD (`DEV_WORKFLOW.md` §6c) — measurement, not tested production code.
- **Method:** (1) seed a real dev household with 300 recipes with realistic title lengths and 10–15 ingredients each (§12.5.3 — not `Recipe 001`, so the number is comparable at a W14 re-run) via a throwaway script or direct SQL, not committed as production code; (2) build in **profile mode** (never debug) on the lowest-end physical Android available; (3) scroll the Library end-to-end three times, capture frame timings via DevTools; record **p50/p99 frame build+raster times, count of frames >16ms/>32ms, jank percentage, time-to-first-paint**; (4) separately record the **payload** `Query.recipes` returns for 300 recipes — bytes and wall-clock.
- **Pass/fail:** target <5% of frames over 16ms, no frame over 100ms during steady scroll, Library time-to-first-paint under 1.5s on a **warm** backend (Aurora auto-pause would otherwise contaminate the number — §12.5.4).
- **If it fails:** verify `ListView.builder` recycling (should already hold from S6 — verify, don't assume) and add **pagination to `Query.recipes`** — an SDL change, cheaper now (one consumer) than at W10 (picker sheet) or W14 (curated seed).
- **Depends on:** S6 (needs a real Library to scroll). Runs right after S6 (D9), before S7/S8, so a pagination finding doesn't force rework of already-built screens.
- **Size / Risk:** ~1.5 hrs / **Medium** — risk is device availability, not technical. Named fallback (D9): lowest-end physical Android on hand, exact device/SoC recorded, result treated as an upper bound. A simulator/emulator run is not a substitute.
- **Agents:** none mandated (spike). `doc-updater` records the result.

#### S11 — `onRecipeChanged` subscription (D6 — pulled forward from a planner-recommended W8)

- **Delivers:** `Subscription.onRecipeChanged(householdId)`, per-field authorization resolver (§11.2.9's pattern — same security property as an API-level authorizer, far less machinery), wired into the existing multiplexed `AppSyncSubscriptionClient` (generic since W5 S8). `RecipeLibraryController` subscribes and refetches on push — the "every push means refetch" decision (§11.2.12), a `Stream<void>` + `_refetch()`, mirroring `PantryController`. **`RecipeDetailController` wiring is deferred**, not delivered here: S11 runs before S7 in the actual working order (§12.4), so no Detail screen/controller exists yet for it to wire into. The Detail screen's own slice (S7) must add this same subscribe-and-refetch wiring when it builds `RecipeDetailController` — do not treat the exit-criteria box below as covering Detail-screen sync until that happens.
- **Files:** `shared/schema.graphql` (`Subscription.onRecipeChanged`); `api/src/resolvers/onRecipeChanged.ts` (or the equivalent field-authorizer wiring `onPantryChanged.ts` used); `infra/stacks/api-stack.ts`; `mobile/lib/features/recipes/state/recipe_library_controller.dart` (`recipe_detail_controller.dart` is S7's own file, not this slice's); `mobile/lib/shared/graphql/operations/on_recipe_changed.graphql` (subscription op).
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

#### 12.5.6 S10 result — real-AWS round trip verified; two-device sync NOT run this pass

**Deploy verification:** `cdk diff Parimaan-dev-Data Parimaan-dev-Api` (plus their `Network`/`Auth` dependency stacks) against the real dev account showed **zero differences** — every W6 backend slice (S1–S5, S7, S11) had already been deployed individually at merge time, per this project's own established per-slice-deploy pattern, so S10 needed no new `cdk deploy`. Confirmed directly, not assumed.

**Real round trip (direct Lambda invoke against dev Aurora, synthetic Cognito identities, not synth):** create → `Query.recipe` (single-id read) → `Query.recipes` with **explicit `null`** on both nullable filter args (`role`, `isFavorite` — accepted and correctly returned the created recipe, the exact `.optional()`-vs-`.nullish()` regression class W5 §11.5.5 found) → `favoriteRecipe(true)` → `setInRotation(false)` → `updateRecipe` (real scalar change + whole-list ingredient replace, both applied correctly) → cross-household read denial (a second household's member reading the first household's recipe by id got the identical `NotFound` a nonexistent id would, confirming RLS — not app-layer `householdId` gating — is what's actually enforcing this) → `deleteRecipe` → `Query.recipe` again (confirmed `NotFound`, not a stale read). Also verified directly: `createRecipe` missing `role` fails `VALIDATION`; an unrecognised `role` and an unrecognised `cuisineTier1` are both rejected, not passed through (D4). Separately confirmed (also correct, and worth recording since the first attempt read like a bug before checking the schema): `updateRecipe` **rejects** an explicit `null` on a patch scalar (`cookMin: null`) — `recipePatchInputSchema` is deliberately `.optional()`, not `.nullish()`, on every patch field (clearing a field via patch isn't supported yet, per that schema's own doc), so this is correctly-enforced behavior, not the W5 bug class recurring. All throwaway households/recipes created for this pass were deleted afterward via `deleteHousehold`/cascade — nothing left in dev Aurora from this run.

**Two-device `onRecipeChanged` verification (RUNBOOK.md §3): NOT performed this pass.** RUNBOOK.md §3's own prerequisites explicitly require two physical devices on independent real networks and explicitly exclude a simulator/emulator pair (same reasoning D9 used to keep S9's emulator run non-authoritative) — an agent session has no physical devices to drive, and the founder declined running an exploratory simulator-only substitute (which couldn't satisfy §3's bar either, for the identical reason) or deferring it further this pass. **The exit-criteria box for two-device sync stays open, honestly, until a human runs RUNBOOK.md §3 on two real devices** — the mechanism itself (`onRecipeChanged` fan-out, per-field authorization, mobile subscribe/refetch) was built and reviewed in S11, but its live cross-device timing is unverified.

**Coverage (re-measured, not assumed):** Lambda 95.63% statements (`vitest run --coverage`, all-files aggregate) — well over the 80% gate enforced in CI since W5. Flutter domain+state 84.41% line coverage (796/943 lines across `lib/**/domain/` and `lib/**/state/`, computed from `flutter test --coverage`'s `lcov.info`) — over 80%, though several individual recipe files sit well below the aggregate (`recipe_source.dart` 0%, `recipe_ingredient.dart` 8%, `recipe.dart` 57%) since most of `Recipe`'s own logic is exercised indirectly through mapper/controller/widget tests rather than direct domain-class unit tests; flagged here rather than silently passed since the aggregate threshold can hide a genuinely undertested file.

**`security-reviewer`:** not re-run in this pass. Each of S1–S5 and S11's own PRs ran `security-reviewer` as a mandatory per-slice gate before merge (S1/S2 specifically for the `recipe_ingredients` RLS surface, §12.5.2's own highest-severity flag) and none surfaced an unresolved CRITICAL/HIGH — taken on trust from that established per-slice practice, the same "not re-verified in this pass" call the W5 exit-criteria section made for S1–S3.

**SD re-sync (§6.1/§7.1/§18):** §7.1's DDL and §18's decisions log were already current, added in S1/S2's own PRs (verified directly against the deployed DDL, not assumed). §6.1's SDL, however, had drifted since S7/S11 shipped: `Query.recipe(id: ID!)` (S7's own deviation) and the entire `Subscription.onRecipeChanged` field (S11) were both missing from `SYSTEM_DESIGN.md`, and the Mutation-block comment above the five recipe mutations still read "Not yet shipped as of W6 S2" — stale since S3–S5 merged. Fixed in this pass: both fields added (matching `shared/schema.graphql` exactly, doc comments included), the stale comment corrected.

**§4 actuals — the W5 carry-over ("start logging real wall-clock time per slice from W6 onward," §11.5.5) landed, via a different mechanism than planned.** No stopwatch was run per slice, but every W6 slice's PR-merge timestamp is real, checkable data (`git log --format=%ad`), and the deltas between consecutive merges are a genuine (if noisy — they include CI wait time, review-agent runtime, and any think-time between "go ahead" messages, not pure hands-on-keyboard time) proxy for per-slice wall-clock, which is more than W5 had:

| Slice | S1 | S2 | S3 | S4 | S5 | S6 | S9 | S11 | S7 | S8 | **Total (plan-lock → S8 merge)** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| planned hrs (§12.5.1) | 2.0 | 2.5 | 2.0 | 1.5 | 1.0 | 2.5 | 1.5 | 1.5 | 2.0 | 2.5 | **20.0** |
| actual (merge-to-merge) | 0.88 | 1.06 | 0.71 | 1.31 | 1.39 | 1.23 | 2.16 | 0.64 | 1.17 | 0.99 | **11.55** |

All ten slices (plan lock through S8's merge) landed inside a single continuous session on **2026-08-27**, 10:51→22:23 IST — not the two-calendar-week span D8 accepted as a fallback. The **20.0-hr estimate (§12.5.1) turned out roughly 42% high against this proxy** — the opposite direction from W5's overrun pattern (§11.5.5's S7/S8 both ran over). Plausible reasons, not verified further: the §12.5.1 estimate was built before S7's `Query.recipe` deviation and S8's form architecture were known in detail, and a single continuous session avoids the context-reload tax a multi-day gap would add between slices — neither claim is more than a plausible read of one data point, not a revised estimating model. S10 itself (this verification + doc pass) started on **2026-08-28**, a real one-day gap after S8's merge — its own duration isn't captured by the merge-timestamp method above since it produces no intermediate PR merges to diff.

### 12.6 W6 exit criteria

- [x] `recipes` and `recipe_ingredients` on dev with RLS **enabled and forced on both**, policies covering `USING` **and** `WITH CHECK`, `parimaan_app` grants on both — verified by wrong-household tests for read, insert, update, delete, **including a direct `recipe_ingredients` read by `recipe_id`** (S1, `#40`)
- [x] `recipes.updated_at`, the `cuisine_tier1` CHECK, and the `recipe_ingredients` RLS line reflected in SD §7.1 with rationale (S1/S2 — deferred from S1's own PR, closed here; SD §18 decisions log also updated)
- [x] All five recipe mutations + `Query.recipes` + `Recipe.ingredients` live on dev, each member-gated (or RLS-gated, for the id-only and field resolvers), each with a non-member denial test (S2–S5) — re-confirmed live against real dev AWS in S10 (§12.5.6)
- [x] `role` is required on create with no default; a `createRecipe` missing `role` fails `VALIDATION` — the DoD gate's "role assignment required", asserted by a named test (S3, D1) — re-confirmed live in S10
- [x] Unknown `role`/`cuisineTier1`/`dietaryTag` values are **rejected, not passed through**, at both the resolver and the DB `CHECK` (S2/S3, D4) — `role`/`cuisineTier1` re-confirmed live in S10 (both resolver-rejected and DB-`CHECK`-backed); `dietaryTags` is resolver-rejected only, by design — its DB column stays unconstrained JSONB (`api/migrations/1787808112003_recipes.ts`'s own comment), a single value's `CHECK` doesn't extend cleanly to an array column, and the resolver is what actually protects `Query.recipes`' serialization
- [x] Every nullable argument tested with an explicit `null`, not only an absent key (§11.5.5's regression, all backend slices) — re-confirmed live in S10: `Query.recipes`' `role`/`isFavorite` filters correctly accept explicit `null`; `updateRecipe`'s patch fields correctly *reject* explicit `null` (deliberately `.optional()`, not `.nullish()` — clearing via patch isn't supported yet), confirmed as intended behavior, not a recurrence of the bug
- [x] `shared/schema.graphql` gains the recipe SDL and is re-synced into SD §6.1, including `RecipeInput`, `RecipePatchInput`, and `deleteRecipe: Recipe!` (D3) — `Query.recipe`/`Subscription.onRecipeChanged` were still missing from SD §6.1 pending S10; added there now
- [x] `/home` is a **three**-tab shell; existing W5 router/shell tests pass unmodified except the tab-count assertion (S6)
- [x] Wireframes 7.1, 7.2, 7.3, **8.2** shipped → **22/49** (S6/S7/S8, D2)
- [x] `RecipeCard` built and covered; the Library GraphQL document provably does not select `ingredients` (S6, D5)
- [x] Favorite and rotation toggles work from the Overflow menu and are visible to a second member (S5/S7) — re-confirmed live in S10
- [x] Create and edit both work end-to-end through the structured form, role required with no pre-selection (S8, D2/D1)
- [ ] `onRecipeChanged` fans out add/update/delete across two devices — **two-device sync verified per `RUNBOOK.md` §3**, timed, target <5s, same honesty standard as W5 §11.5.5 (S11/S10, D6) — **not run**: RUNBOOK.md §3 explicitly requires two physical devices on independent real networks and explicitly excludes a simulator/emulator pair; none were available to this S10 pass, and a simulator-only substitute was declined as unable to satisfy §3's own bar anyway (§12.5.6). Stays open until a human runs the real procedure.
- [ ] **R7 spike run and written up with real p50/p99 frame numbers and a payload size** (S9, D9) — still only the exploratory emulator pass (§12.5.5); no physical Redmi-class device has been available yet
- [x] Coverage: Lambda ≥80% (enforced in CI since W5); Flutter domain+state ≥80% — re-measured in S10: Lambda 95.63%, Flutter domain+state 84.41% (§12.5.6)
- [x] `security-reviewer` clean on S1–S5 and S11 (per-slice triggers; no phase-boundary sweep this week) — taken on trust from each slice's own per-slice gate, not re-run in S10 (§12.5.6)
- [x] Every backend slice verified against real dev AWS, not synth — including a full create → favorite → rotate → edit → delete round trip from a real device (S10) — done via direct Lambda invoke against real dev Aurora/AppSync with synthetic Cognito identities (this codebase's established smoke-test method, e.g. S7's own verification), not a literal mobile-app run; §12.5.6 has the full round trip
- [x] §4's W6 row has actual hours (per-slice wall-clock) and carry-over notes — §12.5.6's actuals table, built from real PR-merge timestamps rather than a stopwatch; the carry-over note is itself now closed (W5 asked for "start logging... from W6 onward" — done, via merge timestamps rather than manual logging)
- [x] §4's W10 row corrected to "consumes `setInRotation`" (already reflected — §12.2.16)

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

## 13. W7 detailed plan — URL import + freeform AI parse

**Status:** LOCKED, 2026-08-28. Drafted by the **planner** agent following §11/§12's structure, then walked through decision-by-decision with the founder. All eleven decisions (D1–D11) are locked below — see §13.7. **W7 is a multi-week sprint at full scope** (D9), same pattern as W5 and W6. **W7 also carries a scoped, deliberate deviation from the locked docs' Bedrock-everywhere assumption: this week's AI runs on Gemini 2.5 Flash** (D11, §13.2.2).

**Budget:** ~10 hrs nominal against Phase 2's ~40 hrs / 4 weeks (§7). Locked scope estimates **~24.0 hrs** (§13.5.1) — a ~140% overrun, on top of a §7 buffer that W5 spent ~8 hrs of and W6 (§12.5.1, D8) formally claimed the rest of. W7 is where the buffer is not merely spent but overdrawn; D9 accepts that knowingly rather than trading scope for it.

**Pipeline:** `DEV_WORKFLOW.md` §2.1 applies unmodified to every slice below. Per §11.7 Q6 this plan folds into this document rather than a `docs/plans/` file. **`DEV_WORKFLOW.md` §6c applies to S1 specifically** — spikes are explicitly exempt from strict TDD; they are measurement, not tested production code.

**Process carry-over from W6 (§12.5.6):** the per-slice wall-clock method that actually worked (PR-merge timestamps via `git log --format=%ad`) is carried forward unchanged. W6 also leaves **two exit-criteria boxes genuinely open** — the physical-device two-device `onRecipeChanged` run (`RUNBOOK.md` §3) and the R7 300-item scroll spike on a real Redmi-class device (§12.5.5). Both stay **W6's** obligations, not W7's; neither blocks any W7 slice. They are listed here only so they are not quietly inherited and then forgotten.

**Research & Reuse is non-negotiable this week.** `DEV_WORKFLOW.md` §2.2 names "JSON-LD parsers (W7)" by name as one of four places where mature OSS exists and hand-rolling is the wrong default. S4 does not start until that search has run and been written down. S2 carries the same obligation for the Gemini SDK.

### 13.1 What W7 is locked to deliver

| Focus | Screens | Backend/infra | DoD gate |
|---|---|---|---|
| URL import + freeform AI parse **spike week** | Choose method (8.1), URL import (8.3), Freeform input (8.4), Freeform review (8.5), AI failure fallback (12.1) → **27/49** | JSON-LD parser; `parseFreeformRecipe` via **Gemini 2.5 Flash** (D11); Zod validation; **JSON-LD spike, top-20 Indian blogs** (R2, day 1); AIProposal widget | ≥16/20 blogs parse; freeform AI returns valid JSON |

Wireframe 8.2 (Structured form) is **not** in this row — it shipped in W6 (§12.2.1, D2). The cumulative count is unaffected: 22/49 at end of W6 + 5 = **27/49**, exactly as §4's W7 row states.

**Removed from W7 by this plan:** the **Bedrock `ap-south-1` availability spike (R1)** that the §4 row and §6 R1 assumed would be W7's day-1 blocker. D11 replaces Bedrock with Gemini for this week, and Gemini has no AWS-region model-access question at all. **§6 R1's risk row is therefore moot for W7** — it is not "resolved," it is *not applicable*, and it stays live only for whichever future week (if any) revisits Bedrock. Said plainly here so nobody later reads an unchecked R1 box as a W7 miss. See §13.3's cut record.

**Added to W7 by this plan** (not in the §4 row):

- **A non-VPC Lambda resolver category in `api-stack.ts`** (§13.2.1). Every resolver in this codebase today is placed in `PRIVATE_ISOLATED` subnets behind a VPC with `natGateways: 0`. A Lambda that must fetch an arbitrary third-party URL — or reach `generativelanguage.googleapis.com` — cannot live there. This is architecture, not an enhancement.
- **The shared AI invocation helper (SD §8.2) pulled forward from SD §16's "month 5"**, re-provider'd to Gemini per D11 — W7 is the first AI feature, so the AI plumbing lands now whether or not the sprint table said so.
- **A Gemini API key in Secrets Manager**, following the *existing* Google-OAuth-client-secret pattern (`auth-stack.ts` line 93's `SecretValue.secretsManager('parimaan/google-oauth-secret')`) and the *existing* cold-start fetch pattern (`api/src/db/pool.ts`'s `GetSecretValueCommand` + `api/src/db/config.ts`'s Zod-validated `*_SECRET_ARN` env var). No new secrets pattern is invented (§13.2.2).
- **A provenance argument on `createRecipe`** (§13.2.4). W6 shipped `createRecipe` with `sourceType` hardcoded to `'user'` and no `sourceUrl` in `RecipeInput` (both deliberate, §12.2.3/D3). Neither `url` nor `freeform_ai` is reachable through any shipped write path today, so "confirm the draft" has nowhere to land.
- **An ingredient-string parser** (`"2 cups atta"` → `{quantity: 2, unit: 'cup', name: 'atta'}`), which neither `RecipeIngredientInput` nor JSON-LD's `recipeIngredient` (a flat string array) supplies for free.
- **A pre-committed decision rule for the R2 spike outcome** (§13.2.11, D10) — written *before* the spike runs, so a mid-week number does not become a mid-week judgment call.
- **A routing rework of W6's Library FAB.** `recipes_library_screen.dart` currently pushes `AppRoutes.recipeCreate(...)` directly (two call sites, lines 90 and 169). Wireframe 8.1 inserts a chooser between them.

**Out of scope** (tracked, not forgotten): photo pantry (W18); cook-from-pantry (W19); AI staples note (W15); **the AI-provider choice for W15/W17/W18/W19 — explicitly left OPEN, not decided by D11** (§13.2.2); AI response caching (W19 — §13.2.13); the $5/day cost alarm and its DDB/CloudWatch wiring (W17/W22); PostHog acceptance-rate instrumentation (W22 — so W7's own acceptance measurement is manual, §13.5.7); Drift local cache for recipes (**W14**, §12.7 D7); `Query.recipes` pagination (deferred pending the still-open R7 spike); curated seeding (W13/W14); the duplicate-recipe action (§12.2.10, still unscheduled); recipe cover images (§12.2.11, descoped); the router's unconditional `/first-run` redirect (§11.2.11 — **still open, still W8's first slice**); subscription reconnect backoff + refetch-on-reconnect (W8).

### 13.2 Conflicts and gaps found in the locked docs

Items marked **LOCKED (Dn)** were open decisions in the planner's draft, now resolved by the founder (§13.7 has the full table). Items marked **CALL** are judgment calls implemented as stated. Items marked **NOTE** are informational or forward-flags.

#### 13.2.1 CRITICAL, LOCKED (D3) — no W7 resolver that touches the internet can live where every other resolver lives

`infra/stacks/network-stack.ts` builds the VPC with `natGateways: 0` and covers AWS-service traffic with four VPC endpoints (S3 gateway, DynamoDB gateway, `BEDROCK_RUNTIME` interface, Secrets Manager interface). Every resolver Lambda is created by `ApiStack.createDbResolverFunction`, which pins `vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED }` and attaches the shared `lambdaSecurityGroup`.

An isolated subnet with no NAT has **no route to the public internet at all**. `importRecipeFromUrl` must `GET https://<any-indian-recipe-blog>/...`; `parseFreeformRecipe`, post-D11, must reach Google's Generative Language API. Neither can be a `DB_RESOLVERS` entry as written. Three options were weighed:

| Option | Cost | Consequence |
|---|---|---|
| **A. Non-VPC Lambda** | $0 | Gets internet via Lambda's own managed networking. **Cannot reach Aurora**, so `requireHouseholdMember` cannot run. Reaches DynamoDB (rate limits) and Secrets Manager (the Gemini key) over the public, IAM-signed endpoints, which is fine and is exactly how those services are designed to be consumed. |
| **B. Add a NAT Gateway** | ~$32–45/mo | Blows the `<$35/mo` MVP run-rate DoD (§8) on its own, for one feature. |
| **C. VPC resolver → `lambda:InvokeFunction` → non-VPC fetcher** | +1 interface endpoint (~$9.5/mo/AZ) + a second Lambda | Preserves the membership check; two Lambdas, two cold starts, and a new endpoint, all to gate mutations that persist nothing. |

**LOCKED (D3): Option A for BOTH `importRecipeFromUrl` and `parseFreeformRecipe`, and `householdId` is dropped from both signatures.** The honest position is that if the membership check cannot be enforced, the argument should not be accepted — this codebase's whole existence-oracle convention (§12.2.5, `updateRecipe`/`deleteRecipe`) is built on never accepting an argument whose authorization you then skip. Both mutations read no household data and write nothing; the caller is still a verified Cognito principal, and the real control on abuse is the per-user daily rate limit (§13.2.9), which works fine keyed on the Cognito `sub` alone.

The draft version of this decision applied Option A only to `importRecipeFromUrl` and left `parseFreeformRecipe` VPC-attached "if the Bedrock spike clears ap-south-1." **D11 removes that fork entirely**: Gemini is a public HTTPS API with no AWS PrivateLink or interface-endpoint story, so a VPC-attached `parseFreeformRecipe` has no route to it either. Both AI mutations are non-VPC by the same reasoning, and there is no spike left to wait on. This is an SD §6.1 signature deviation → `architect` step 2b + `doc-updater` §4.1.

#### 13.2.2 DEVIATION, LOCKED (D11) — W7's AI runs on Gemini 2.5 Flash, not Bedrock/Claude Haiku

`SYSTEM_DESIGN.md` and `PRD.md` assume Bedrock everywhere: §6 R1's whole risk row is "Bedrock model availability in `ap-south-1`", WS-7 is framed as a Bedrock workstream, SD §8.2/§8.4 sketch `InvokeModel` with `anthropic_version` and a cross-region client swap, and SD §15.1 carries a Bedrock ap-south-1 spike as an open assumption. **W7 deviates from all of that, deliberately and in a scoped way**, and this section is the deviation record — the same treatment other weeks give their own deviations (§12.2.3's `RecipeInput` shape, §11.2.4's pantry-unit pass-through).

**The decision:** `parseFreeformRecipe`, and the freeform-fallback path off a failed URL import, both call **Gemini 2.5 Flash**.

**What this changes, concretely:**

1. **The former S1 (Bedrock `ap-south-1` availability + VPC-reachability spike) is CUT ENTIRELY.** Its entire content was AWS-account-specific: is a Haiku model ID invocable in `ap-south-1`, does a fresh model-access grant come through in time, does it work through the `BEDROCK_RUNTIME` interface endpoint, and which of three mitigations applies if not. Gemini has none of those questions — an API key either works or it doesn't, and finding out takes one `curl`, not a day-1 calendar-blocking console request. §6 R1's risk row is **moot for W7** (see §13.1).
2. **The old draft's §13.2.2 finding — that SD §8.4's `try ap-south-1 / catch → us-east-1` fallback is unreachable from an isolated subnet with no NAT — is now W7-irrelevant but still TRUE, and stays recorded.** Whichever future week revisits Bedrock inherits it. `doc-updater` writes it into SD §18 as a standing finding, not as a W7 action item.
3. **Auth changes from AWS IAM to an API key.** There is no `bedrock:InvokeModel` policy, no model-ARN scoping, and no Bedrock resource policy in W7. Instead: a Gemini API key in Secrets Manager at `parimaan/gemini-api-key`, referenced by ARN through a `GEMINI_API_KEY_SECRET_ARN` env var, validated at cold start by the Zod config schema, fetched once per Lambda container with `GetSecretValueCommand` and cached in module scope. **This is not a new pattern — it is the two patterns this codebase already runs**: `auth-stack.ts` line 93 already sources the Google OAuth client secret via `cdk.SecretValue.secretsManager('parimaan/google-oauth-secret')`, and `api/src/db/pool.ts` + `api/src/db/config.ts` already do exactly this cold-start-fetch-and-cache against `APP_ROLE_SECRET_ARN`. S2 copies that shape rather than inventing one. The key itself is created out-of-band in the Secrets Manager console and referenced by CDK, never in a CDK literal and never in the repo — same as the OAuth secret.
4. **No VPC endpoint work at all.** The AI Lambda is non-VPC (D3), so it reaches Secrets Manager and DynamoDB over their public IAM-signed endpoints and Gemini over plain egress. **W7 does not touch the existing idle `BEDROCK_RUNTIME` interface endpoint in `infra/stacks/network-stack.ts`.** That construct stays exactly as-is: dead-for-now infrastructure, harmless, potentially reused by a future Bedrock-using week. Not W7's to remove and not W7's to migrate. *(One honest cost flag for the founder, not a W7 slice: an interface endpoint bills hourly whether or not traffic flows, so an idle one is not literally $0. Whether to keep or drop it is a §8 cost-DoD question for whichever week next revisits the network stack — recorded here so it is a decision someone makes rather than a line item nobody notices.)*
5. **Cost, with real numbers.** Gemini 2.5 Flash is **$0.30/M input tokens and $2.50/M output tokens**, against Claude Haiku 4.5 on Bedrock at **$1/M input and $5/M output**. A freeform parse is roughly 1,500 input + 700 output tokens: **≈$0.0022 on Gemini vs ≈$0.005 on Haiku**, a bit under half. At D8's 20 parses/user/day cap that is **≈$0.044/user/day worst case**. The founder holds **$300 of pre-existing Gemini credit**, which covers W7's entire realistic usage — the spike, prompt iteration, and S12's 20-parse acceptance measurement together are single-digit dollars — regardless of where the exact per-call number lands.
6. **The provider choice for W15 (staples note), W17 (vision), W18 (photo pantry) and W19 (cook-from-pantry) is EXPLICITLY LEFT OPEN.** D11 is scoped to W7. Those weeks pick their own provider when they are planned, informed by what W7 measures. This is precisely why S2's invocation layer is named provider-neutrally (§13.3 S2) — the seam is where a future week swaps providers without touching resolvers.

**CALL:** the deviation is written into SD §18 as a decision with this rationale, and SD §15.1's Bedrock ap-south-1 assumption is annotated "not exercised in W7 (D11); still open for any future Bedrock week" rather than being marked resolved or deleted.

#### 13.2.3 CRITICAL, LOCKED (D1) — SD §6.1 returns `Recipe!` from both mutations, and `Recipe!` cannot represent an unsaved draft

`SYSTEM_DESIGN.md` §6.1 lines 542–543:

```
importRecipeFromUrl(householdId: ID!, url: String!): Recipe!   # returns draft, requires confirm
parseFreeformRecipe(householdId: ID!, text: String!): Recipe!  # AI, returns draft
```

The comments say "draft"; the type says `Recipe!`. `Recipe` (as shipped in `shared/schema.graphql` after W6) has **ten non-null fields that a draft has no honest value for**: `id`, `householdId`, `sourceType`, `servings`, `dietaryTags`, `role`, `inRotation`, `isFavorite`, `createdAt`, `updatedAt`. Returning it forces fabricated ids and timestamps, and — worse — hands the client a value structurally indistinguishable from a persisted row. Every Ferry-generated cache, every `RecipeCard`, every `recipe_mapper.dart` path would treat it as real. This is exactly the class of bug §12.2.7's Library/Detail split was written to avoid, in a nastier form.

Reusing `RecipeInput` is not available either: GraphQL input types cannot be used as output types.

**LOCKED (D1): a new `RecipeDraft` output type**, deliberately shaped as "what `RecipeInput` needs, plus what the user must be told about it":

```graphql
"""
An UNSAVED, UNPERSISTED proposal produced by `importRecipeFromUrl` or
`parseFreeformRecipe`. Deliberately NOT a `Recipe`: it has no `id`, no
`householdId`, and no timestamps, so it cannot be mistaken for a stored row
by any client cache or mapper (E2E_MVP_PLAN.md §13.2.3). Nothing is written
to the database until the user confirms and the client calls `createRecipe`
with the corresponding `source` attribution (§13.2.4).
"""
type RecipeDraft {
  title: String
  description: String
  servings: Int
  prepMin: Int
  cookMin: Int
  cuisineTier1: CuisineTier1
  cuisineTier2: String
  dietaryTags: [DietaryTag!]!
  role: RecipeRole                  # NULLABLE and unconfirmed — see §13.2.6 / D5
  ingredients: [RecipeIngredientDraft!]!
  steps: [String!]!
  sourceUrl: String                 # set by importRecipeFromUrl, null for freeform
  """
  Human-readable, already-localisable-later notes about what the parser or
  the model could not determine or had to discard — e.g. an unrecognised
  cuisine value that was dropped rather than failing the whole parse
  (§13.2.5). Never an error channel: a draft with warnings is still a draft.
  """
  warnings: [String!]!
}

type RecipeIngredientDraft {
  """The original, unmodified source string (`"2 cups atta, sifted"`). Kept
  verbatim so nothing the parser could not decompose is silently lost."""
  raw: String!
  name: String!
  quantity: Float
  unit: String
  notes: String
}
```

`title` is nullable here even though `Recipe.title` is `String!` — a parse that finds no title is still worth returning with the ingredients it did find, and the review screen blocks submit until the user supplies one. Note also that `RecipeIngredientDraft` has no `category`/`isStaple`: neither JSON-LD nor a Gemini parse produces those reliably, and `RecipeIngredientInput` already defaults `isStaple` to `false` server-side.

#### 13.2.4 CRITICAL, LOCKED (D2) — "confirm" has nowhere to land: `createRecipe` hardcodes `sourceType: 'user'` and cannot write `sourceUrl`

`api/src/resolvers/createRecipe.ts` line 36 sets `sourceType: 'user'` unconditionally, and its own doc comment says so as a security property ("never client-suppliable, `RecipeInput` has no such field in the SDL at all"). `api/src/repositories/recipeRepository.ts`'s insert column list (line 212) omits `source_url` entirely, though the column exists (`1787808112003_recipes.ts` line 42) and `RecipeSource` already carries `url` and `freeform_ai` (`shared/schema.graphql` lines 412–418).

So W6 reserved the enum values and then shipped no path that can produce them. Confirming a draft today would silently persist a URL-imported recipe as `sourceType: user` with no `sourceUrl` — losing provenance permanently, since there is no backfill.

Two shapes were weighed:

- **(a) Extend `createRecipe` with an optional attribution argument** — `createRecipe(householdId: ID!, input: RecipeInput!, source: RecipeSourceAttribution)`, where `RecipeSourceAttribution { sourceType: RecipeSource!, sourceUrl: String }`. Server-side rules: absent → `'user'` (every existing caller keeps working unchanged, no client migration); `sourceType` **restricted at the resolver to `url` and `freeform_ai` only** — `curated` (W13/W14's seeder) and `ai` (W19's cook-from-pantry) are server-set values a client must never be able to claim; `sourceUrl` required when `url` and rejected otherwise.
- **(b) A server-side draft token** — the parse mutations write the draft into the DDB cache table with a TTL and return an opaque `draftId`; confirm passes `draftId` and the server reads back the provenance it recorded itself.

**LOCKED (D2): (a).** (b) is genuinely more truthful about provenance — a client cannot lie about where a recipe came from — but it adds a stateful round trip, a new DDB access pattern, a TTL-expiry failure mode ("your draft expired") that needs its own UX, and a second copy of the draft on the server, all to protect a self-reported label on a recipe inside the user's own household. The lie is low-stakes and unexploitable across households. (a) is one optional argument and one repository column. The client re-sends `sourceType` + `sourceUrl` at confirm time.

#### 13.2.5 CRITICAL, LOCKED (D4) — Zod on LLM output is a trust boundary, and "reject the whole thing" is the wrong default for enum fields

This is the security-relevant one. `parseFreeformRecipe`'s response is **model-generated text**, and `importRecipeFromUrl`'s is **third-party-controlled HTML**. Neither is input the way `PantryItemInput` is input; both are *untrusted output* that this system then hands to a mobile client and, one confirm later, writes to Postgres. `DEV_WORKFLOW.md` §2.3 lists any AI prompt or response path as a `security-reviewer` trigger for exactly this reason, and SD §8.2 steps 4–6 make schema validation a mandated step, not hygiene.

Concretely, the parsed object must be validated for:

- **Structure** — the JSON parses at all; `ingredients`/`steps` are arrays of the right shape; no unexpected keys are passed through into anything downstream.
- **Bounds** — reuse `createRecipe`'s caps exactly (**100 ingredients, 100 steps, 2,000 chars/step**, §12.3 S3) plus a title bound. A draft that could not be saved must never be proposed. Without a bound, a model that loops can return megabytes and the Lambda cheerfully forwards it to a phone.
- **Enums** — `role`, `cuisineTier1`, `dietaryTags` are closed (§12.2.6, W6's D4), and a Gemini parse of a Punjabi rajma recipe will very plausibly emit `"punjabi"`, `"indian"`, or `"vegetarian"` — none of which are in `CuisineTier1` (`north_indian`, `south_indian`, `pan_india`, `indo_chinese`, `continental`) or `DietaryTag` (`veg`, `vegan`, `jain`, `eggetarian`, `gluten_free`, `dairy_free`). Gemini's `responseSchema` structured-output mode reduces but does **not** eliminate this — a constrained-decoding guarantee from the provider is not a validation boundary we own, and S2's Zod layer is authoritative regardless.
- **Injection** — nothing in the model's output is ever interpolated into SQL, a URL, or a subsequent prompt. (It isn't today; the test exists so it stays that way.)

W6's D4 locked "reject, don't pass through" for enums *at the `createRecipe` write boundary*, and that stays correct. The open question was the **parse** boundary: if the model returns a perfect 14-ingredient rajma recipe and calls the cuisine `"punjabi"`, does the whole parse fail?

**LOCKED (D4): asymmetric — strict on structure and bounds, lenient-with-warnings on enums.** An unrecognised `cuisineTier1`/`dietaryTag` is dropped (coerced to `null` / filtered out) and recorded in `RecipeDraft.warnings`; a structural or bounds violation fails the parse and takes the §13.2.7 retry path. Rationale: this is the *identical* reasoning §12.2.6 already used on the read side ("one bad row degrades one field, never the whole query"), applied to one bad field degrading one field rather than the whole parse. Failing an 80%-correct parse over a cuisine label is the single easiest way to miss PRD §11's ≥80% acceptance target for a reason that has nothing to do with parse quality. The strictness that matters — nothing unbounded, nothing unsaveable, nothing interpolated — is unaffected.

#### 13.2.6 CONFLICT, LOCKED (D5) — an AI-proposed `role` collides with W6's D1 "no default anywhere"

§12.7 D1 locked: `role` is "required on create, **no server default, no pre-selected UI chip**." The AIProposal widget's entire purpose is to pre-fill fields for the user to accept or edit. If the model returns `role: "sabzi_dal"` and the Freeform review screen renders that chip selected, D1 is violated by the letter and arguably by the spirit — the user can tap Save without ever having made a role decision.

Three readings were weighed: (i) the model must not propose `role` at all, and the review screen shows an empty required picker; (ii) the model may propose it, but the chip renders in a visually distinct *proposed* state and submit stays blocked until the user affirmatively confirms or changes it (one tap, but a real one); (iii) D1 is about the blank structured form only and an AI proposal is exempt.

**LOCKED (D5): (ii).** **W6's D1 still holds in full — no recipe can save with a role nobody actively chose.** The proposal is an affordance, not a default. It also generalises: the same "proposed until confirmed" state is what the W18 photo-pantry and W19 cook-from-pantry `AIProposal` reviews will need, so building it here is not a one-off. `RecipeDraft.role` stays nullable either way (the model omitting it must be representable).

#### 13.2.7 GAP, LOCKED (D7) — the "AI failure fallback" wireframe has no resolver-level contract behind it

SD §14 gives four one-line rows ("throttled → exponential backoff 3×"; "unparseable JSON → retry once with reinforcement"; etc.) and SD §8.2 gives six numbered comment-steps. Neither is a contract: there are no timeouts, no shared deadline, no error codes, and no statement of which failures the client should offer a *retry* for versus which should route to the fallback screen. A wireframe named "AI failure fallback" cannot be built against that. `DEV_WORKFLOW.md` §3.2 already mandates the RED test ("malformed/non-JSON model output → retry once → second failure → `AIError` surfaced as a friendly message") — this section is what that test asserts against.

**The contract, LOCKED as specified**, implemented in `api/src/ai/invokeModel.ts` (S2) and consumed identically by every future AI feature:

**One deadline governs everything.** At handler entry, `deadline = now + AI_DEADLINE_MS` (**20,000 ms**). Every retry decision checks the remaining budget first and gives up rather than starting an attempt it cannot finish. The ceiling exists because AppSync's Lambda-resolver invocation is bounded at 30s regardless of the Lambda's own timeout (§13.2.8) — an unbounded "3× backoff" as SD §14 words it can walk straight past it and produce a generic AppSync timeout instead of any of our own error codes, which is precisely the failure the fallback screen is supposed to explain.

> **The 20,000 ms figure is an estimate, not a measured number.** The draft plan intended to validate it against the cut Bedrock spike's latency measurement (§13.2.2). With that spike gone, **S2 validates it empirically instead**: S2's step 1 includes ten real Gemini 2.5 Flash calls on a representative ~4,000-character parse, recording p50/p95, and `AI_DEADLINE_MS` is set from that measurement before S2 merges. If a single attempt turns out to run 6s+, **the retry policy shrinks; the deadline does not grow** — 30s is AppSync's, not ours to negotiate. One Gemini-specific factor to measure explicitly: 2.5 Flash performs internal "thinking" by default, which inflates both output-token count and latency; S2 measures with and without `thinkingBudget: 0` and records which the prompt ships with.

**Two independent, separately-bounded retry chains:**

| Chain | Trigger | Policy | Exhausted → |
|---|---|---|---|
| Transport | HTTP 429, 503, 500, connection reset/timeout from the Gemini endpoint | up to **2 retries** (3 attempts total), jittered backoff ~500ms then ~1,500ms, deadline-gated | `AI_BUSY` |
| Output | `JSON.parse` failure, or Zod **structural/bounds** failure (never an enum-only failure, §13.2.5) | exactly **1 reinforcement retry** — same prompt plus a "return valid JSON only, no prose, no markdown fences" system reinforcement, `temperature: 0.2` unchanged (SD §8.6) | `AI_UNPARSEABLE` |

**The error taxonomy the client actually branches on** (extends `api/src/errors.ts`'s existing shape, so `graphql_error_mapper.dart` gets a real code, not a string match):

| Code | Cause | Retryable by user? | Mobile destination |
|---|---|---|---|
| `AI_BUSY` | transport chain exhausted | **Yes** | inline retry on the input screen — the text is not lost |
| `AI_UNPARSEABLE` | output chain exhausted (2 bad responses) | No | **AI failure fallback screen (12.1)** |
| `AI_UNAVAILABLE` | provider rejected the credential or the request outright — HTTP 401/403, key revoked, model ID retired, quota exhausted at the account level | No | fallback screen, different copy |
| `AI_TIMEOUT` | deadline hit with no usable response | **Yes** | inline retry |
| `RATE_LIMITED` | our own daily cap (existing `RateLimitedError`, §13.2.9) | No, not today | distinct copy — "you've used your 20 AI parses today", **never** the generic failure screen |
| `VALIDATION` | input rejected before any spend — empty, or >4,000 chars (SD §13.4) | n/a | inline on the input field, no Gemini call made |

**The fallback screen's job is to not lose the user's work.** Its non-negotiable behaviour: the pasted text (or the entered URL) survives, and one tap opens W6's `RecipeFormScreen` seeded with whatever *was* extractable — for `AI_UNPARSEABLE` that may be nothing but an empty form, which is still strictly better than a dead end. This is also the R2 mitigation's landing point ("copy-paste fallback UX") and SD §14's "Manual entry always available" row, made concrete.

**Never retried:** `RATE_LIMITED`, `VALIDATION`, `AI_UNAVAILABLE`, and any enum-only Zod failure (that path warns, §13.2.5). **The rate limit is consumed exactly ONCE per user-initiated mutation call, before the first attempt, regardless of how many transport or reinforcement retries happen inside it** — otherwise a throttled user silently loses three days' budget in one tap. This is asserted by its own named test in S2.

#### 13.2.8 CRITICAL — AppSync's 30-second resolver ceiling, not Lambda's timeout, is the real bound

`api-stack.ts`'s resolver Lambdas carry a generous timeout sized for Aurora auto-pause resume (~30s cold, §11.5.4). AppSync's invocation of a Lambda resolver is separately capped at **30 seconds**; past that the client gets an AppSync-level timeout, not our error envelope, and none of §13.2.7's taxonomy reaches the phone.

Both W7 AI-adjacent resolvers can plausibly approach it: `parseFreeformRecipe` (Gemini latency × up to 3 attempts, plus thinking overhead) and `importRecipeFromUrl` (DNS + TLS + a slow blog + redirects). **CALL:** hard sub-budgets, all enforced client-side in the Lambda, all inside §13.2.7's single 20s deadline — **8s** total for the outbound HTTP fetch including redirects, **1MB** response cap with a streaming abort past it, and the transport/output retry chains deadline-gated as specified. S2's measured p50/p95 is what confirms 20s is the right number.

#### 13.2.9 GAP, LOCKED (D8) — rate limits: one exists, one doesn't, and both are the week's actual cost control

`api/src/rateLimit/dailyActionLimiter.ts` already implements exactly what SD §8.5 requires — an atomic, race-safe, per-user-per-UTC-day counter with TTL against the shared `cacheTable`. It ships in production behind `joinHousehold`. **W7 needs no new rate-limit infrastructure whatsoever**, only two `action` names and two caps, plus the `api-stack.ts` grant loop (which today grants `dynamodb:UpdateItem` to exactly two Lambdas and is asserted by a test that will fail when a third appears — as designed).

That file's own doc contains the constraint that matters: *"Existing action names are load-bearing production data: changing one orphans every live counter written under the old key, so treat them as frozen strings, not cosmetic labels."* The two names are therefore a decision, not a detail.

**LOCKED (D8):** `'freeformParse'` at **20/day per user** (SD §8.5's stated number, already locked in earlier planning) and `'urlImport'` at **30/day per user** (new). The remaining action names are reserved now while none are live, so the whole scheme is chosen once rather than accreted: `'photoPantry'` (W18), `'cookFromPantry'` (W19), `'staplesNote'` (W15).

**Why these caps carry more weight than they look like they do, and why that is stated rather than left implicit:** the CloudWatch `$5/day` spend alarm and its DDB/CloudWatch wiring are deferred to W17/W22 (§13.1, out of scope). That means for W7 there is **no reactive spend detection at all** — nothing that notices a runaway loop, a stuck retry, or a curious user burning credit, and nothing that pages anyone. These two per-user daily caps are **THE actual preventive cost control shipping this week**, not a formality and not defence-in-depth on top of something else. At 20 parses × ≈$0.0022 (§13.2.2) the worst case is ≈$0.044/user/day, which is what makes the $300 Gemini credit a comfortable rather than a nervous number. The cap being enforced *before* the first provider call — and consumed exactly once per user call regardless of internal retries (§13.2.7) — is therefore a cost property, not just a fairness one, and S2/S3's "no provider call was made" assertions are cost-control tests, not merely validation tests.

#### 13.2.10 CRITICAL — SSRF: `importRecipeFromUrl` is a server-side fetcher pointed at a user-supplied URL

This is the highest-severity item in W7, the direct analogue of §12.5.2's role in W6. An authenticated user hands us a URL and we fetch it with the server's network identity. Even with D3's non-VPC placement (which removes the "reach our own private subnets" prize), the standard attack surface remains: `http://169.254.169.254/...` (the instance/container metadata endpoint), `file://`, `gopher://`, RFC1918 and loopback and link-local addresses, DNS names that resolve to private space, **redirect chains that start public and land private**, DNS-rebinding between the validation lookup and the connect, and using our egress IP as an anonymising relay against a third party.

**CALL — the mandatory control set, all of it in S5, all of it RED-tested:**

- Scheme allowlist: `https` only (not even `http`).
- Reject credentials-in-URL, non-default ports, and any host that is an IP literal rather than a name.
- Resolve DNS explicitly and **reject if any resolved address is in a private, loopback, link-local, CGNAT, or reserved range** — checked for every address returned, not just the first.
- **Follow at most 3 redirects, re-running the full validation on every hop.** This is the control most often omitted and the one that most often matters.
- Bind the connection to the validated address where the runtime permits it, to close the rebinding window; where it doesn't, treat the shortened window as accepted residual risk and say so in the SD §18 entry rather than implying it's closed.
- 8s total budget, 1MB response cap with streaming abort, `Content-Type` must be HTML-ish.
- A descriptive, contactable `User-Agent` identifying Parimaan — see §13.2.14.
- The fetched bytes are **never** echoed back to the client. Only the parsed `RecipeDraft` is. An error never includes the response body, headers, or a resolved IP — that is an internal-network oracle.

`security-reviewer` **fires** on S5 and must be given this list explicitly as the review checklist, not left to infer it.

#### 13.2.11 GAP, LOCKED (D10) — R2's mitigation is written as a UX ("copy-paste fallback") with no threshold that triggers it

§6 R2 sets the target at ≥16/20 and the §4 W7 DoD gate repeats it, but nothing says what happens at 12/20. Deciding that *after* seeing the number is how a spike result gets rationalised instead of acted on. **LOCKED (D10) — the rule is pre-committed here, before S1 runs:**

| S1 result | Action |
|---|---|
| **≥16/20** | Ship as planned. URL import is the **primary path** on screen 8.1. |
| **10–15/20** | Ship the mutation, but **paste is promoted to equal visual prominence with URL import** on screen 8.1 — not a buried fallback — and screen 8.3's failure state (now common, not exceptional) gets first-class copy pointing at the freeform path. No code is cut; emphasis and copy change. |
| **<10/20** | **Cut the JSON-LD parser, resolver, and URL-import screen entirely — S4, S5, and S9** (~7.5 hrs). Screen 8.3 becomes a paste-assist ("open the page, copy the recipe, paste it here") routing into 8.4, and W7 ships copy-paste-only. Revisit in v1.1 with a site-specific scraper set, never with an LLM-parses-the-HTML approach (§13.2.12). |

**If the <10/20 branch fires, S4/S5/S9 are marked `CUT — D10, S1 returned n/20` in §13.3 and their rows kept in §13.5.1's table with their hours struck through. They are not silently deleted from this plan.** That is this codebase's own convention for deviations — the same way W6's S8 recorded that `recipe_form_entry.dart` was skipped rather than quietly omitting it — and it is what makes a v1.1 revisit possible without re-deriving the reasoning.

**This is a quality gate, not a schedule one.** D9 commits URL import at full scope for this week; the only thing that can remove it is S1's measured number falling below 10/20, and nothing about the hours.

The nuance the raw count hides, which S1 must record separately: a page having `application/ld+json` with `@type: Recipe` is **not** the same as it parsing into a usable draft. S1 reports both numbers (§13.3 S1), and the thresholds above apply to the *usable-draft* number, which is the one the DoD gate actually cares about.

#### 13.2.12 CALL — LLM-parsing-the-HTML is explicitly out of scope for URL import

When the JSON-LD parse fails, the obvious-looking move is to feed the page's text to the model. **Not in W7, and the reason should be recorded before someone reaches for it under S1-result pressure:** it takes a third party's arbitrary HTML — the most hostile prompt-injection substrate available, and one an attacker fully controls by hosting a page — and pipes it into a model whose output we then propose to a user. It also multiplies cost per import by an unbounded factor of page length, which cuts directly against §13.2.9's point that per-user caps are this week's only cost control. The locked mitigation for a failed URL import is the *user* copying the text they can see (SD §14, R2), which keeps a human between the hostile page and the model. If this is ever revisited, it is a v1.1 design with its own threat model, not a W7 fallback branch.

#### 13.2.13 NOTE — do not cache either mutation in W7

SD §8.6 scopes caching to cook-from-pantry (30 min per household+pantryHash) and the staples note; freeform parse is deliberately absent, and unique inputs make it pointless anyway. URL import *looks* cacheable per URL — the same blog page yields the same draft — but caching it means storing third-party content server-side keyed by a value one user supplies and another might collide with, which is a cache-poisoning and cross-household-leak question this week does not need to answer for a saving of one HTTP GET. **CALL:** no cache in W7; revisit in W19 when the invocation layer's cache path is built for cook-from-pantry anyway.

#### 13.2.14 NOTE — robots.txt, ToS, and the request we send

Server-side fetching of third-party recipe pages on a user's behalf, at ≤30 requests/user/day, for content the user is about to read anyway, is ordinary user-agent-on-behalf-of-user behaviour rather than crawling — but it is worth a recorded position rather than an assumed one. **CALL:** send an honest, contactable `User-Agent` (`Parimaan/1.0 (+https://parimaan.app)`), never spoof a browser, respect `4xx`/`429` without retrying (a `429` from a blog becomes a plain user-facing failure, not a backoff loop), and do **not** fetch `robots.txt` for a single user-initiated fetch. If W13/W14 ever bulk-imports curated recipes from these sources, that is crawling and the position changes. Flagged for the founder as a business-judgment item, not a technical blocker.

#### 13.2.15 NOTE — W7 ships no migration, and that is a first since W3

`source_type`'s `CHECK` already accepts `'url'` and `'freeform_ai'`; `source_url TEXT` already exists. S6 needs only to add `source_url` to `insertRecipe`'s column list. Consequence: **`database-reviewer`'s "mandatory on every migration" gate does not fire anywhere in W7** — the first week that's been true since W3. Recorded so its absence reads as a fact about the week rather than a skipped step.

#### 13.2.16 NOTE, forward-flag — `onRecipeChanged` needs nothing from W7

A confirmed draft is created through `createRecipe`, which is already on `onRecipeChanged`'s `@aws_subscribe` mutation list (`shared/schema.graphql` line 260). URL-imported and AI-parsed recipes therefore fan out to other devices for free. No W7 subscription work — the parse mutations themselves are deliberately *not* subscribed to (nothing is persisted, and a draft is one user's private in-flight work, not household state).

#### 13.2.17 NOTE — `AIProposal` is the fifth domain widget and the first with no CSS-component precedent

WS-5 lists five domain widgets; `PantryRow` (W5), `RecipeCard`, `MealSlot`, `ChecklistItem` are the others. `mobile/lib/shared/ui/components/` currently holds ten primitives and no `AIProposal`. Per `DEV_WORKFLOW.md` §3.3, **goldens are for `lib/shared/ui/` design-system components only** — `AIProposal` is a domain widget and gets behaviour tests, not a golden, exactly as `PantryRow` and `RecipeCard` did. **CALL:** build it generic over "a proposed value the user accepts, edits, or rejects" rather than recipe-shaped, since W18's per-item photo-pantry review is its second consumer and W19's is its third.

### 13.3 Slice breakdown

**Twelve slices, one PR each.** **S1 runs first and is exempt from strict TDD** (`DEV_WORKFLOW.md` §6c) — its output is written-up numbers plus, potentially, the removal of three slices.

> #### CUT before the week started — former S1, "Bedrock `ap-south-1` availability + VPC reachability spike (R1, day 1)"
>
> **Status: CUT, not deferred, not skipped.** The draft plan opened W7 with a day-1 spike to establish whether a Claude Haiku model ID was invocable in `ap-south-1` on the dev account, whether that invocation worked from a VPC-attached Lambda in `PRIVATE_ISOLATED` through the existing `BEDROCK_RUNTIME` interface endpoint, which of three mitigations applied if not, and what the p50/p95 parse latency was on the chosen path. It was sized at ~1.5 hrs and rated **High** risk, mostly because a fresh Bedrock model-access grant is a *calendar* blocker rather than an effort one.
>
> **Why it was cut:** D11 (§13.2.2) replaces Bedrock/Claude with Gemini 2.5 Flash for both of W7's AI mutations. Every question this spike existed to answer is Bedrock-specific — AWS regional model availability, account-level model access, and reachability through a regional VPC interface endpoint. Gemini is a public HTTPS API reached from a non-VPC Lambda (D3) with a Secrets-Manager-held key; there is no region gate, no access grant, and no endpoint to route through. The one genuinely provider-agnostic thing the spike would have produced — a measured latency distribution to validate §13.2.7's 20s deadline — **has been relocated into S2's step 1**, not lost.
>
> Recorded here rather than deleted so that (a) §6 R1's now-moot risk row has a traceable explanation, and (b) whichever future week revisits Bedrock inherits the spike's full question list ready-made.

#### S1 — JSON-LD coverage spike, top-20 Indian recipe blogs (R2, day 1)

- **Delivers:** §6 R2 resolved against the ≥16/20 gate, and D10's pre-committed rule executed. **Two numbers, not one:** (a) how many of 20 pages expose `application/ld+json` containing an `@type: Recipe` node; (b) how many parse into a **usable draft** — defined up front as title + ≥1 ingredient + ≥1 step. (b) is what the DoD gate and D10's thresholds apply to.
- **Method:** the founder picks the 20 blogs (this is a product judgment about what Indian households actually cook from — Hebbar's Kitchen, Vah Reh Vah, Sanjeev Kapoor, Cook With Manali, Dassana, Archana's Kitchen and similar, plus a deliberate few regional/low-production-value sites, because the top-6 SEO winners all have perfect schema markup and would flatter the number). Fetch each page once, save the raw HTML into a fixture directory, and record per site: ld+json present? `@type` shape (string vs array vs `@graph`)? which of title/ingredients/steps/yield/times/image are present? `recipeInstructions` shape (plain string vs `[String]` vs `[HowToStep]` vs `[HowToSection]`)? ISO-8601 durations parseable? any microdata/RDFa fallback available where ld+json is absent?
- **The saved fixtures are the deliverable that outlives the spike** — S4's test suite runs against them, which is the only way to get real-world JSON-LD messiness into a unit test without network calls in CI. Commit the fixtures (small, static HTML); note their provenance and that they're test data, not redistributed content.
- **Files:** `api/test/fixtures/jsonld/*.html` (new, committed); `docs/E2E_MVP_PLAN.md` (§6 R2 row + a results table in §13.5).
- **Depends on:** nothing. **Day 1.**
- **Size / Risk:** ~2.0 hrs / **High** — the risk is entirely the result. A <10/20 outcome cuts three slices (D10) and is the single largest possible change to this week's shape.
- **Agents:** none mandated (spike). `doc-updater` records the result, including which D10 tier fired.

#### S2 — `invokeModel` AI invocation layer (Gemini 2.5 Flash) + Secrets Manager API key + the non-VPC resolver category *(new infrastructure — full pipeline)*

First AI call, first third-party-API call, and first non-VPC Lambda in this codebase. Own design decision per §2.2 step 2b.

| # | Step | Agent | Concrete action | Gate |
|---|---|---|---|---|
| 1 | Research & Reuse | *none* | **Mandatory.** Current `@google/genai` SDK version and whether its `responseMimeType: 'application/json'` + `responseSchema` structured-output mode is worth using on top of our own Zod layer (it reduces malformed output but is **not** the trust boundary, §13.2.5). Whether the SDK's own retry behaviour can carry §13.2.7's transport chain rather than hand-rolling it. Whether `thinkingConfig: { thinkingBudget: 0 }` is right for this workload. `gh search code` for Zod-validated Gemini JSON-output patterns. **Also in this step: the ten real latency calls that set `AI_DEADLINE_MS` (§13.2.7) — p50/p95 on a representative ~4,000-char parse, with and without thinking, recorded in SD §18.** | Adopt-vs-hand-roll written down; SDK/structured-output choices decided with reasons; `AI_DEADLINE_MS` set from measured data, not from the 20,000 ms estimate. |
| 2 | Plan (novel arch) | `architect` | Record: (a) **D11's provider deviation in full** (§13.2.2) — including that W15/17/18/19 stay open, that the idle `BEDROCK_RUNTIME` endpoint is untouched, and that SD §8.4's cross-region finding remains true-but-W7-irrelevant; (b) the §13.2.7 retry/deadline/taxonomy contract, in full, as the thing every future AI feature will share; (c) the non-VPC Lambda category in `api-stack.ts` and why (§13.2.1); (d) prompts live in `api/prompts/*.ts` with a `PROMPT_VERSION` constant (SD §8.3) — logged, never containing household data at rest; (e) the secret's name, ARN plumbing, and cold-start fetch, explicitly as a copy of the `APP_ROLE_SECRET_ARN`/`parimaan/google-oauth-secret` pattern. | Decisions in SD §18. |
| 3 | RED | `tdd-guide` | Gemini client **always stubbed** (`DEV_WORKFLOW.md` §3.2 — real calls are S2 step 1 and S12 only, never CI). Transport chain: 429 → 429 → success returns the value; three 429s → `AI_BUSY`. Provider auth: HTTP 403/401 → `AI_UNAVAILABLE` with **no** retry and **no** AWS or credential internals in the message. Output chain: non-JSON → reinforced retry → success; two bad responses → `AI_UNPARSEABLE`; **markdown-fenced JSON (` ```json `) is stripped and accepted, not treated as a failure** (the most common LLM output-format deviation, Gemini included). Deadline: a slow first attempt that leaves insufficient budget does **not** start a retry and yields `AI_TIMEOUT`. Bounds: a 10,000-ingredient response is rejected, not forwarded. Enum leniency (§13.2.5): unknown `cuisineTier1` → `null` + a warning, *not* a failure, and specifically **not** a reinforcement retry. **Rate limit consumed exactly once across all internal retries** (§13.2.7/§13.2.9). Secret: a missing/malformed `GEMINI_API_KEY_SECRET_ARN` fails loudly at cold start (mirroring `api/src/db/config.ts`'s existing behaviour and its test); the fetched key is cached per container and never logged. **CDK (§3.4, fine-grained before snapshot):** the non-VPC Lambda has **no** VPC config, **no** `lambdaSecurityGroup`, and **no** access to `appRoleSecret`; it has `secretsmanager:GetSecretValue` scoped to the **Gemini secret's ARN only**, never a wildcard; the DDB `UpdateItem` grant extends to exactly the AI/net Lambdas and no others (the existing test that asserts "exactly two" changes deliberately, with its rationale updated); **no `bedrock:*` policy is added anywhere, and `network-stack.ts` is untouched** (assert the snapshot is unchanged for that stack). | Failures shown. |
| 4 | GREEN | *none* | `api/src/ai/{geminiClient,invokeModel,errors}.ts` — `geminiClient` is the only file that knows the provider, `invokeModel` is the provider-neutral, Zod-validated seam every resolver calls; `api/src/ai/config.ts` (Zod-validated `GEMINI_API_KEY_SECRET_ARN`, same shape as `api/src/db/config.ts`); `api/prompts/` (empty scaffold + `PROMPT_VERSION` convention); `infra/stacks/api-stack.ts` (`AI_RESOLVERS`/`NET_RESOLVERS` alongside `DB_RESOLVERS`, plus the scoped Secrets Manager grant). | Tests pass. |
| 5 | REFACTOR | `tdd-guide` | `invokeModel` is generic over `z.ZodSchema<T>`, knows nothing about recipes, **and knows nothing about Gemini** — the provider lives behind `geminiClient`. This seam is what lets W15/W17/W18/W19 pick a different provider without touching a resolver (§13.2.2 point 6). | Clean. |
| 6 | Domain review | `typescript-reviewer` | — | Addressed. |
| 7 | Security | `security-reviewer` | **FIRES**, three separate triggers: AI prompt/response path; CDK IAM policy + a new secret; third-party SDK addition. Specifically: the API key is never in CDK source, never in an env var value, never logged, and never returned in an error; `secretsmanager:GetSecretValue` is ARN-scoped; no prompt or model output logged at a level that persists household content (SD §8.3); the non-VPC Lambda's IAM role is genuinely minimal (one secret + one DDB action + logs, nothing else); error messages returned to the client carry no provider or AWS internals; **the rate limit is charged before the first outbound call** (§13.2.9 — reviewed as a cost control, not only as abuse prevention). | No CRITICAL/HIGH. |
| 8 | General | `code-reviewer` | — | Clean. |
| 9 | Docs | `doc-updater` | SD §8.2 replaced with the real signature; §8.4 annotated per §13.2.2 point 2; §15.1's Bedrock ap-south-1 assumption annotated "not exercised in W7 (D11)"; §16's "month 5" AI-plumbing row noted as pulled forward; §6 R1 marked moot-for-W7. | Synced. |

**Depends on:** nothing — **can start day 1 alongside S1.** (This is a direct benefit of cutting the former S1: the week's foundational backend slice is no longer gated behind a spike.) **Size / Risk:** ~2.5 hrs / **High** — the week's foundational backend slice; every future AI feature inherits whatever is wrong here, and it is the codebase's first integration with a non-AWS provider.

#### S3 — `RecipeDraft` SDL + `parseFreeformRecipe`

- **Delivers:** `RecipeDraft`/`RecipeIngredientDraft` in `shared/schema.graphql` (§13.2.3, D1); `Mutation.parseFreeformRecipe(text: String!): RecipeDraft!` — note **both** the return-type deviation and the `householdId` drop (D3), each an SD §6.1 deviation; the Gemini prompt in `api/prompts/parseFreeformRecipe.ts` with `PROMPT_VERSION`; the Zod output schema (§13.2.5, D4); `'freeformParse'` at 20/day via the existing `checkAndIncrementDailyAction`.
- **Files:** `shared/schema.graphql`; `api/prompts/parseFreeformRecipe.ts`; `api/src/validation/parseFreeformRecipe.ts` (input) + `api/src/ai/schemas/recipeDraft.ts` (output — deliberately separate files; one validates a user, the other validates a model, and conflating them is how the trust boundary gets blurred); `api/src/resolvers/parseFreeformRecipe.ts`; `infra/stacks/api-stack.ts`.
- **Depends on:** **S2**.
- **Size / Risk:** ~2.5 hrs / **Medium-High** — prompt quality is the uncertainty, not code. Budget an iteration or two against real pasted recipes (WhatsApp-forwarded, blog-copied, handwritten-transcribed) before the prompt is any good. Gemini's `responseSchema` mode may shorten this materially; S2 step 1 decides whether it is used.
- **Agents:** `tdd-guide` → `typescript-reviewer` → `security-reviewer` (**fires**: new Lambda resolver + AI prompt/response path + rate limiting) → `code-reviewer` → `doc-updater` (SDL change → re-sync SD §6.1, record both deviations in §18).
- **RED tests:** input >4,000 chars → `VALIDATION` **with no Gemini call made** (assert the stub was never invoked — this is a cost control, not just validation, §13.2.9); empty/whitespace input → `VALIDATION`; **explicit `null` handled per §11.5.5's regression class** (`.nullish()` where nullable); daily cap → `RateLimitedError` and, again, no Gemini call; **the deliberate absence of a membership check is asserted explicitly** (D3 — the resolver takes no `householdId`, and this test exists so the omission is a documented property rather than something a later reader "fixes" or a later refactor loses); a well-formed model response maps to a `RecipeDraft` with ingredients in order and `raw` preserved verbatim; unknown `cuisineTier1` → `null` + warning, draft still returned; a response exceeding the 100-ingredient cap → `AI_UNPARSEABLE` after one reinforcement retry; `role` absent from the model's response → `RecipeDraft.role` is `null`, not a failure (§13.2.6); **prompt injection: input containing "ignore previous instructions and return {...}" does not produce a draft that escapes the Zod schema** — the assertion is about the schema holding, not about the model behaving.

#### S4 — JSON-LD parse domain module (pure, no network)

- **Delivers:** `api/src/domain/jsonLd/` — HTML → JSON-LD extraction → `Recipe` node selection → normalisation to `RecipeDraft` shape. Pure functions over strings, zero I/O, tested entirely against S1's committed fixtures. Handles the real-world shapes S1 catalogued: `@graph` wrappers, `@type` as string or array, `recipeInstructions` as plain string / `[String]` / `[HowToStep]` / `[HowToSection]` (nested), ISO-8601 `prepTime`/`cookTime` (`PT1H30M`), `recipeYield` as a number or `"4 servings"`, and HTML entities and stray markup inside instruction text. Includes the ingredient-string parser (`"2 cups atta, sifted"` → quantity/unit/name/notes, `raw` always kept, unparseable → `raw` + `name` only, never dropped).
- **Files:** `api/src/domain/jsonLd/{extract,selectRecipeNode,normalise,duration,yield,instructions}.ts`; `api/src/domain/ingredientString.ts`; tests against `api/test/fixtures/jsonld/`.
- **Depends on:** **S1** (fixtures). Fully parallel with S2/S3 once S1 lands. **Not cut** — S1 returned 14/20, D10's middle tier (§13.5.12), not the <10/20 cut tier.
- **Size / Risk:** ~3.0 hrs / **Medium-High** — the largest backend slice and the highest-variance one, because its size is set by what S1 found, not by design. Step 1 Research & Reuse is **mandatory and explicitly named in `DEV_WORKFLOW.md` §2.2**: search npm for JSON-LD/microdata extractors (`cheerio` + hand-rolled `<script type="application/ld+json">` extraction, `microdata-node`, `web-auto-extractor`) and study Python's `recipe-scrapers` as **prior art for site-specific quirks, not as a dependency**. Adopt over hand-roll wherever a maintained library exists; hand-roll only the Parimaan-specific normalisation.
- **Agents:** `tdd-guide` → `typescript-reviewer` → `security-reviewer` (**fires**: third-party SDK addition — an HTML parser is parsing hostile input; check for prototype-pollution-prone JSON handling and unbounded recursion on nested `HowToSection`) → `code-reviewer`.
- **RED tests:** each committed fixture parses to its expected draft (table-driven, one case per site); a page with no ld+json returns "no recipe found", never throws; `@graph` with a `Recipe` among five other node types selects the right one; `@type: ["Recipe","NewsArticle"]` is accepted; a `HowToSection` tree flattens to ordered steps; `PT1H30M` → 90; `"4 servings"` → 4 and `"makes 12 laddoos"` → `null` rather than a wrong number; **deeply nested JSON does not blow the stack** (an adversarial fixture, hand-written, not scraped); `"1/2 tsp हल्दी"` keeps its Devanagari name intact; an ingredient string with no parseable quantity still yields a draft ingredient with `raw` and `name`; **two real S1 findings, not hand-written:** a `Recipe` node with well-formed metadata but `recipeIngredient`/`recipeInstructions` both empty arrays (`bongeats`'s fixture) is **not usable**, not a partial draft; a `Recipe` node whose ingredient/instruction fields structurally pass but contain placeholder/redirect text like "Available in post please open the link" (`nishamadhulika`'s fixture, verbatim) is flagged the same way an unparseable `raw`-only ingredient already is, not silently shown as a clean draft (§13.5.12).

#### S5 — `importRecipeFromUrl` resolver + SSRF-safe fetcher

- **Delivers:** `Mutation.importRecipeFromUrl(url: String!): RecipeDraft!` (note the `householdId` drop, D3) on the non-VPC resolver category from S2; the §13.2.10 URL validator and bounded fetcher; S4 wired behind it; `'urlImport'` at 30/day; SD §14's "couldn't read this page" failure mapped to a code the client can branch on.
- **Files:** `shared/schema.graphql`; `api/src/net/{safeUrl,fetchPage}.ts` (new — deliberately its own module, not inside the resolver, because it is a security control with its own test suite and later features may reuse it); `api/src/resolvers/importRecipeFromUrl.ts`; `infra/stacks/api-stack.ts`.
- **Depends on:** **S2** (non-VPC category), **S4** (the parser). **Not cut** — see S4's note.
- **Size / Risk:** ~2.5 hrs / **High** — highest-severity security surface of the week (§13.2.10), and the only one where a defect is exploitable by an authenticated user rather than merely wrong.
- **Agents:** `tdd-guide` → `typescript-reviewer` → `security-reviewer` (**FIRES** — hand it §13.2.10's control list as the explicit checklist) → `code-reviewer` → `doc-updater`.
- **RED tests** (the validator's suite is the point of this slice): `http://`, `file://`, `gopher://`, `ftp://` all rejected; `https://169.254.169.254/...` rejected; `https://localhost/`, `https://127.0.0.1/`, `https://[::1]/`, `https://10.0.0.1/`, `https://192.168.1.1/`, `https://100.64.0.1/` all rejected; a hostname resolving to a private address rejected (injected resolver); **a public URL 302-ing to `http://169.254.169.254/` rejected on the redirect hop** — the single most important test here; >3 redirects rejected; a 2MB response aborted at the 1MB cap; a server that accepts and then never sends aborted at 8s; `Content-Type: application/pdf` rejected; a 429 from the origin surfaces as a plain failure with no retry; **an error never contains the response body, a header, or a resolved IP**; daily cap → `RateLimitedError` before any DNS lookup; a fixture page end-to-ends into a `RecipeDraft` carrying `sourceUrl`.

#### S6 — `createRecipe` provenance: the confirm path

- **Delivers:** D2's locked shape — `createRecipe(householdId: ID!, input: RecipeInput!, source: RecipeSourceAttribution)`, `sourceType` restricted server-side to `url`/`freeform_ai` (absent → `'user'`, unchanged for every existing caller), `sourceUrl` required-iff-`url`, and `source_url` added to `recipeRepository.insertRecipe`'s column list.
- **Files:** `shared/schema.graphql`; `api/src/validation/createRecipe.ts`; `api/src/resolvers/createRecipe.ts`; `api/src/repositories/recipeRepository.ts`.
- **Depends on:** S3 (for `RecipeSource` semantics to be settled). Independent of S4/S5.
- **Size / Risk:** ~1.0 hr / **Low-Medium**. Small, but it is the one W7 slice that touches a shipped, tested, deployed mutation — every existing `createRecipe` test must still pass **unmodified**, which is itself the strongest evidence the argument is genuinely optional.
- **Agents:** `tdd-guide` → `typescript-reviewer` → `security-reviewer` (**fires**: modifies an existing Lambda resolver's authorization-adjacent input surface) → `code-reviewer` → `doc-updater`.
- **RED tests:** absent `source` → `sourceType: 'user'`, `sourceUrl: null` (and every W6 `createRecipe` test passes untouched); `{sourceType: url, sourceUrl}` persists both and round-trips through `Query.recipe`; `{sourceType: freeform_ai}` persists with `sourceUrl: null`; **`{sourceType: curated}` and `{sourceType: ai}` are both rejected** (`VALIDATION`) — server-owned values, and this test is what stops W13/W19's provenance from being forgeable; `url` without `sourceUrl` rejected; `sourceUrl` alongside `freeform_ai` rejected; a `sourceUrl` that isn't a valid https URL rejected (it is displayed to other household members later — it is stored, untrusted, third-party-influenced text); explicit `null` on `source` handled per §11.5.5.

#### S7 — `AIProposal` widget + recipe-draft domain/state (mobile)

- **Delivers:** the fifth WS-5 domain widget, built generic over "a proposed value the user accepts, edits, or rejects" (§13.2.17); the Dart `RecipeDraft`/`RecipeDraftIngredient` domain models and mapper; the Ferry operations for both parse mutations; and the shared draft-review controller both review paths use.
- **Files:** `mobile/lib/features/recipes/presentation/ai_proposal.dart` (domain widget, **not** a `lib/shared/ui/` design-system primitive, so **no golden**, `DEV_WORKFLOW.md` §3.3); `mobile/lib/features/recipes/domain/{recipe_draft,recipe_draft_ingredient}.dart`; `.../data/recipe_draft_mapper.dart`; `.../state/recipe_draft_controller.dart`; `mobile/lib/shared/graphql/operations/{parse_freeform_recipe,import_recipe_from_url}.graphql` + regenerated `__generated__/`.
- **Depends on:** S3 (SDL for codegen); S5's SDL if D10 keeps URL import.
- **Size / Risk:** ~2.0 hrs / **Medium** — mirror `features/recipes/` layering exactly; the new part is representing "proposed but unconfirmed" per field, which is state design, not widget design, and belongs in `domain/` where the ≥80% target is cheapest to hit (§3.3).
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`. `security-reviewer` **skips** — presentation over an already-reviewed resolver. **One exception worth stating:** the widget renders server-returned strings that originated from a model or a third-party page. Flutter has no XSS analogue, but a 50,000-character "title" is a real render problem; the bound is enforced server-side in S2, and S7 asserts the widget truncates rather than trusting it.
- **RED tests:** a field with a proposal renders in the proposed state and is visually/semantically distinct from a user-confirmed one (assert via semantics, not pixels); accepting marks it confirmed; editing marks it confirmed *and* user-modified (this is the ≤3-edits metric's data source, §13.5.7); rejecting clears it; a null proposal renders as an ordinary empty field; `warnings` render as non-blocking notes, never as errors; an absurdly long string truncates.

#### S8 — Choose method screen (8.1) + Library FAB rework

- **Delivers:** wireframe 8.1 — Structured / URL import / Freeform paste. Both `recipes_library_screen.dart` FAB call sites (lines 90, 169) redirect from `AppRoutes.recipeCreate` to the new chooser; the structured option then continues to W6's existing route unchanged. **D10 sets the relative prominence of the three options** — URL primary at ≥16/20, URL and paste co-equal at 10–15/20, URL replaced by a paste-assist at <10/20.
- **Files:** `mobile/lib/features/recipes/presentation/recipe_method_screen.dart`; `mobile/lib/app/router.dart`; `mobile/lib/features/recipes/presentation/recipes_library_screen.dart`.
- **Depends on:** nothing. **Can start day 1** alongside S1 and S2 — the one zero-dependency Flutter slice, same role S4 played in W5.
- **Size / Risk:** ~1.0 hr / **Low**.
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`. `security-reviewer` skips.
- **RED tests:** three options render; each routes correctly; the existing W6 "FAB opens the form" tests are updated deliberately (not deleted) to "FAB opens the chooser, chooser opens the form"; the option layout matches whichever D10 tier S1 landed in; if D10 landed <10/20, the URL option is present-and-disabled with a reason and announces its disabled state to screen readers (§11.2.8's precedent).

#### S9 — URL import screen (8.3)

- **Delivers:** wireframe 8.3 — URL field, paste-from-clipboard affordance, an honest in-flight state (this can take several seconds, and Aurora is not even in the path — a spinner with no explanation is where users assume it's broken), success → the shared draft review screen (S10) with source attribution shown, failure → the fallback (S11) with the URL preserved. **S1's result was 14/20 usable drafts — D10's middle tier (§13.5.12): built as planned, but the copy-paste path (routing into S10's freeform input) is given equal visual prominence on this screen, not a buried fallback** — e.g. a real second button/tab, not a link at the bottom, since ~30% of real pasted URLs won't produce a usable draft.
- **Files:** `mobile/lib/features/recipes/presentation/url_import_screen.dart`; `.../state/url_import_controller.dart`; routes.
- **Depends on:** S5, S7, S8. (D10's <10/20 cut tier did not fire — see §13.5.12.)
- **Size / Risk:** ~2.0 hrs / **Medium**.
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`.
- **RED tests:** submit disabled until the field parses as an https URL client-side (cheap pre-check; the server's is authoritative); each server error code renders its own copy per §13.2.7's table — `AI_BUSY`/`AI_TIMEOUT` offer inline retry, `RATE_LIMITED` does not and says why, a parse failure routes to the fallback; the entered URL survives every failure path; success navigates to review with `sourceUrl` populated; a slow response shows progress and the screen stays cancellable.

#### S10 — Freeform input (8.4) + Freeform review (8.5)

- **Delivers:** two wireframes. 8.4: a large paste field with a live character counter against the 4,000-char bound (a hard client-side stop, so a user never spends a rate-limit unit on input the server will reject — §13.2.9). 8.5: the review, built per D6 as a **seeded wrapper over W6's `RecipeFormScreen`** with `AIProposal` affordances rather than a second form implementation — the §11.2.7 seeded-form reuse pattern, **third use**. AI-proposed fields carry a visible "proposed" badge/highlight until the user touches them (this is also what D5 requires). Confirm calls `createRecipe` with S6's `source` attribution. **Both review paths (freeform and URL) use this one screen**, distinguished by an attribution line.
- **Files:** `mobile/lib/features/recipes/presentation/{freeform_input_screen,recipe_draft_review_screen}.dart`; `.../state/freeform_parse_controller.dart`; routes.
- **Depends on:** S3, S7, S8 (and S9 shares the review screen).
- **Size / Risk:** ~2.5 hrs / **Medium-High** — the highest-uncertainty Flutter slice, for the same reason S8 was in W6: seeding an existing dynamic-length-list form from a partially-populated draft, where "the model proposed this" and "the user typed this" must stay distinguishable through edits.
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`.
- **RED tests:** the counter blocks submit past 4,000 chars with no request sent; pasted text survives navigation to review and back; the review seeds every populated draft field and leaves absent ones empty; proposed fields render with the badge and lose it on edit; **`role` is not silently pre-selected — an AI-proposed role renders as a proposal and submit stays blocked until the user affirmatively confirms or changes it** (§13.2.6/D5 — the test that keeps W6's D1 honest); editing a proposed field marks it user-modified; `warnings` render non-blockingly; confirm sends `createRecipe` with `source: {sourceType: freeform_ai}` (and `url` + `sourceUrl` from the URL path — assert both); a `VALIDATION` from `createRecipe` renders inline without losing the draft; **cancel discards without writing anything** (the whole point of the draft design — assert no mutation fired).

#### S11 — AI failure fallback screen (12.1) + mobile error taxonomy

- **Delivers:** wireframe 12.1, and the Dart side of §13.2.7 — `graphql_error_mapper.dart` extended with the AI error codes so the client branches on a code, never on message text. The screen's contract: the user's input is preserved and visible, one tap opens `RecipeFormScreen` seeded with whatever was extractable (possibly nothing), and a second affordance retries where the code is retryable.
- **Files:** `mobile/lib/features/recipes/presentation/ai_failure_screen.dart`; `mobile/lib/shared/graphql/graphql_error_mapper.dart`; `.../domain/ai_error.dart`.
- **Depends on:** S7, S9, S10.
- **Size / Risk:** ~1.5 hrs / **Medium** — small in code, but it is a named wireframe with a real gate and the thing that determines whether a failed parse costs the user their pasted text.
- **Agents:** `tdd-guide` → `flutter-reviewer` → `code-reviewer`.
- **RED tests:** each of the six codes renders its own copy and its own affordances; an **unknown** future code degrades to a generic-but-non-blank state (never an empty screen and never a raw GraphQL string); the preserved input is non-empty on every path that reaches this screen; "enter manually" opens the form seeded with the partial draft; retry re-invokes and, on success, navigates to review.

#### S12 — Real-AWS verification, 20-parse acceptance measurement, weekly doc pass

- **Delivers:** three things. (1) `RUNBOOK.md` §2's non-negotiable real-dev-stack exercise of every W7 backend slice — including at least one call with an explicit `null` for every nullable argument (§11.5.5's regression class), **one real Gemini call end-to-end from the deployed non-VPC Lambda** (which is also the only proof that the Secrets Manager fetch works outside a stub), one real URL import against a live blog, and one deliberate SSRF attempt against the deployed endpoint (the unit tests prove the validator; this proves the deployed thing runs it). (2) **The DoD gate's second half measured**: 20 real freeform parses, recording per parse whether the draft was accepted and how many fields were edited, against PRD §11's "≥80% accepted with ≤3 edits" — plus the URL-import success rate on the same 20 blogs S1 used, now through the shipped mutation rather than the spike script. (3) §4.2's mandatory weekly pass: actuals into §4's W7 row, spike results into §6's R2 row, R1 annotated moot-for-W7 per §13.1, D11's deviation propagated into SD §8.2/§8.4/§15.1/§18, `RUNBOOK.md` entries for anything the real deploy broke — including the Gemini key's rotation procedure, which is new operational surface.
- **Files:** `docs/E2E_MVP_PLAN.md` (§4 W7 actuals + §6 R1/R2 + this §13); `docs/SYSTEM_DESIGN.md` (§6.1 SDL re-sync — `RecipeDraft`, both mutations' real signatures including the `householdId` drops, `createRecipe`'s `source` arg; §8.2 rewritten per S2; §8.4 annotated; §14's four AI rows replaced by §13.2.7's table; §15.1 annotated, §15 item 4 marked resolved; §18 decisions incl. D11); `docs/RUNBOOK.md`.
- **Depends on:** all of S2–S11.
- **Size / Risk:** ~1.5 hrs / **Low** risk, **non-optional** — a week isn't done until its §4 row has actuals (§6d), and the acceptance measurement is half the End-of-Month-2 DoD (§8), which lands at W8, one week away.
- **Agents:** `doc-updater`. **`security-reviewer` phase-boundary sweep does NOT fire this week** — W8 is the §2.3 exception-1 boundary, not W7. Per-slice triggers fired on S2, S3, S4, S5, S6.

### 13.4 Sequencing

```
   DAY 1: THE SPIKE, THE AI FOUNDATION, AND THE ZERO-DEP SCREEN, ALL IN PARALLEL
   ┌───────────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
   │ S1 JSON-LD coverage       │  │ S2 invokeModel       │  │ S8 Choose method │
   │  top-20 blogs (R2)        │  │  (Gemini 2.5 Flash)  │  │  (8.1) + FAB     │
   │  → D10 rule fires         │  │  + Secrets Manager   │  │  (zero deps)     │
   └────────┬──────────────────┘  │  + non-VPC category  │  └────────┬─────────┘
            │  (+ committed        └──────────┬───────────┘           │
            │     fixtures)                   │                       │
   ┌────────▼──────────────────┐   ┌──────────▼───────────┐           │
   │ S4 JSON-LD parse domain   │   │ S3 RecipeDraft SDL + │           │
   │  module (pure, no I/O)    │   │  parseFreeformRecipe │           │
   │  (CUT if D10 <10/20)      │   └────┬──────────┬──────┘           │
   └────────┬──────────────────┘        │          │                  │
            │        ┌───────────────────┘          │                  │
   ┌────────▼────────▼─────────┐                    │                  │
   │ S5 importRecipeFromUrl    │              ┌─────▼──────┐           │
   │  + SSRF-safe fetcher      │              │ S6 create  │           │
   │  (CUT if D10 <10/20)      │              │  Recipe    │           │
   └────────────┬──────────────┘              │  source    │           │
                │                             └─────┬──────┘           │
                │     ┌───────────────────────┐     │                  │
                └────►│ S7 AIProposal + draft │◄────┼──────────────────┘
                      │  domain/state (mobile)│     │
                      └────┬──────────────┬───┘     │
                           │              │         │
              ┌────────────▼────┐  ┌──────▼─────────▼────────┐
              │ S9 URL import   │  │ S10 Freeform input +    │
              │  screen (8.3)   │  │  Freeform review (8.5)  │
              │  (CUT if <10/20)│  └──────┬──────────────────┘
              └────────┬────────┘         │
                       └────────┬─────────┘
              ┌─────────────────▼──────────┐
              │ S11 AI failure fallback    │
              │  (12.1) + error taxonomy   │
              └─────────────────┬──────────┘
              ┌─────────────────▼──────────────────────┐
              │ S12 real-AWS + 20-parse acceptance     │
              │     measurement + doc pass             │
              └────────────────────────────────────────┘
```

**Working order: S1 ∥ S2 ∥ S8 (all day 1) → S4 → S3 → S5 → S6 → S7 → S10 → S9 → S11 → S12.**

Non-obvious choices, with rationale:

- **Three things start on day 1, not one.** The draft plan had two blocking spikes gating everything; cutting the Bedrock spike (§13.2.2) frees the week's foundational backend slice (S2) to start immediately rather than on day 2. That is a real schedule gain from D11 and worth naming, since it partially offsets D9's overrun without cutting anything.
- **S1 still runs first among the JSON-LD work, before a line of its production code.** The cost-asymmetry argument §12.7 D9 used for W6's S9 and §11.4 used for W5's "S8 before S7." S1's outcome can **delete three slices** (D10, ~7.5 hrs). This is not a case where building first and measuring later costs "a bit of rework"; it costs the slice. §6 already schedules R2's spike in W7 — this sequencing is compliance with a locked risk row, not a new preference.
- **S8 on day 1 alongside the spike.** The only zero-dependency Flutter slice, exactly the role S4 played in W5. It gives the week a merged PR while the spike runs, and it de-risks the FAB rework against W6's existing router tests early rather than under end-of-week pressure. Its final option layout is a one-line change once D10's tier is known.
- **S4 before S3, despite S3 being the DoD-gate feature.** S4's only dependency is S1's fixtures, so it can run while S2 is in review; and S4 is the week's largest and highest-variance backend slice (its size is set by what S1 found). Discovering it is a 5-hour slice rather than a 3-hour one is information the week needs early, not on day 9.
- **S10 before S9.** They share the review screen (S10 builds it). The freeform path is also the DoD-gate path *and* the R2 fallback destination, so it must exist regardless of D10 — whereas S9 is the one screen D10 can remove.
- **S6 early and small.** It touches a shipped, deployed mutation; getting that reviewed and merged while the mobile slices are still in flight avoids a late change to a foundation W6 already stands on.

### 13.5 Risks

#### 13.5.1 The week does not fit in 10 hours, and the buffer is already gone — LOCKED (D9)

| Slice | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hrs | 2.0 | 2.5 | 2.5 | 3.0 | 2.5 | 1.0 | 2.0 | 1.0 | 2.0 | 2.5 | 1.5 | 1.5 | **24.0** |

Against ~10 hrs nominal, a **~140% overrun before any surprise** — worse than W5's ~80% (§11.5.1) and W6's 100% (§12.5.1). The §7 20-hr buffer was ~8 hrs down after W5 and formally claimed by W6's D8. There is no buffer left to spend; W7 running two-plus weeks pushes the MVP date directly rather than absorbing into slack.

**LOCKED (D9): accept a multi-week W7 at FULL scope.** URL import is **committed for this week** — S4, S5 and S9 stay in W7. The alternative on the table (deferring URL import to W8 and shipping a freeform-AI-only week) was considered and **explicitly rejected by the founder**. Nothing in this plan should be read as URL import being deferred, at risk, or a candidate for a schedule-driven cut. The **only** thing that can remove it is D10's <10/20 branch, which is a quality gate on measured JSON-LD coverage, not a schedule lever (§13.2.11).

Two honest counterweights, neither of which is a plan: W6's estimate came in **~42% high** against the merge-timestamp proxy (§12.5.6), so 24.0 planned may be ~14 actual on the same measure; and D11 removed 1.5 hrs of spike outright while letting S2 start on day 1 instead of day 2 (§13.4).

#### 13.5.2 SSRF in `importRecipeFromUrl` is the week's highest-severity item

The direct analogue of §12.5.2. A user-supplied URL fetched by our server, in a resolver with no precedent in this codebase, where the failure mode is not a wrong answer but an exploitable one. §13.2.10 lists the full control set; S5's RED suite is the enforcement; `security-reviewer` fires with that list as an explicit checklist rather than being left to infer it. The redirect-revalidation test is the one most likely to be the difference between a control set and a control set that works.

#### 13.5.3 Zod on model output is a trust boundary, not input hygiene — and W7 sets the pattern for every later AI feature

`invokeModel`'s validation step is where untrusted, non-deterministic, partially-attacker-influenceable content stops being text and starts being data this system acts on. W15 (staples note), W17 (vision), W18 (photo pantry), W19 (recipe generation) all inherit whatever S2 establishes — **regardless of which provider each of those weeks picks** (§13.2.2 point 6), which is exactly why the validation layer sits in provider-neutral `invokeModel` and not in `geminiClient`. The specific failure to guard against is not "the model returns garbage" — that is handled and tested — but "the model returns something *plausible* that quietly exceeds a bound," which is why the caps mirror `createRecipe`'s exactly (§13.2.5): a draft that cannot be saved must never be proposed. A provider's own structured-output mode is a convenience, never the boundary. `security-reviewer` fires on S2, S3, S4, S5, and S6.

#### 13.5.4 The JSON-LD spike can delete three slices

Sequenced first for exactly this reason (§13.4). D10 (§13.2.11) pre-commits what happens at each tier, so the result is acted on rather than argued about, and the <10/20 branch's cut is *recorded* rather than silently applied. Residual risk: a borderline result (e.g. exactly 10, or 16 ld+json-present but 11 usable-draft) invites re-litigation — which is precisely why D10 specifies that **the usable-draft number is the one the thresholds apply to** and why S1 reports both numbers separately.

#### 13.5.5 Gemini is a provider this codebase has never called, and this is the first non-AWS integration

New in this plan, and the risk D11 introduces in exchange for the ones it removes. Everything the codebase does today is AWS-SDK-shaped, IAM-authenticated, and VPC-endpoint-reachable. Gemini is none of those: an API key in Secrets Manager, plain HTTPS egress from a non-VPC Lambda, and an SDK (`@google/genai`) with its own error taxonomy that S2 must map onto §13.2.7's six codes. The mitigations are all in S2's design: the provider lives behind one file (`geminiClient.ts`) so the seam is swappable; the secret follows the *existing* `parimaan/google-oauth-secret` + `APP_ROLE_SECRET_ARN` patterns rather than a new one; and S2 step 1's ten real calls surface latency, thinking-token behaviour, and error shapes before any resolver depends on them. **The specific thing that will not be caught by stubs and is therefore S12's job: whether the deployed non-VPC Lambda can actually reach Secrets Manager and Google over public egress**, which is a one-call verification but a total blocker if wrong.

#### 13.5.6 The VPC has no NAT, and this is the first week that matters

§13.2.1 is a finding about the whole week, not one resolver: this architecture was designed for resolvers that talk to AWS services through VPC endpoints, and W7 is the first week with resolvers that must talk to the *internet* — both of them, post-D11. Nothing about the existing design is wrong; it simply does not extend, and the extension (a non-VPC resolver category) is a real, if small, new pattern in `api-stack.ts` with real IAM consequences. The reason it is a risk and not just a task: it is very easy to add `importRecipeFromUrl` or `parseFreeformRecipe` to `DB_RESOLVERS` by habit, deploy successfully, and then debug an 8-second timeout that looks like a slow blog or a slow model.

#### 13.5.7 AppSync's 30s ceiling, plus a cold Aurora on the confirm call

§13.2.8 covers the parse side. The confirm side has the other half: `createRecipe` is VPC-attached and Aurora-backed, so a user who parses successfully and then taps Save after a quiet period eats the ~30s auto-pause resume (§11.5.4) *after* having already waited several seconds for the AI. That is the worst latency sequence in the app so far. No fix in W7 — auto-pause is a locked non-negotiable cost lever (PRD §17.4) — but S10's confirm state must set expectations the way `NameHouseholdScreen.coldStartHint` already does, rather than presenting a spinner that looks hung.

#### 13.5.8 The acceptance-rate gate is subjective and instrumented nowhere

PRD §11 / §8's Month-2 DoD want "≥80% accepted with ≤3 edits" for freeform parse. PostHog lands in W22, so W7's S12 measurement is a founder with a spreadsheet and 20 pasted recipes, judging their own feature. Two mitigations, both cheap: fix the **20 test inputs before measuring** and keep them (a WhatsApp forward, a blog copy-paste, a handwritten transcription, an English-Hindi mix, a no-quantities recipe, a wall-of-text with no line breaks, and so on) so a later prompt or **provider** change can be re-measured against the identical set; and count edits mechanically from S7's user-modified flag rather than by recollection. Without the fixed set the number is not comparable to anything, including its own future self — and given that W15/17/18/19's provider is deliberately open (§13.2.2), a re-runnable benchmark is the main artefact that makes a future provider comparison possible at all.

#### 13.5.9 No reactive cost detection ships this week

The $5/day CloudWatch spend alarm is W17/W22 (§13.1). Until then, D8's per-user daily caps are the entire control surface (§13.2.9) — preventive only, with nothing watching. The residual exposure is bounded and small (≈$0.044/user/day worst case against $300 of credit), but it is *unmonitored*, which means a defect in the "charge the limit exactly once" logic would be invisible rather than merely costly. That is why S2's rate-limit-consumed-once test and S3's no-provider-call-on-rejection tests are called out as cost tests, not just correctness tests.

#### 13.5.10 Legal/business posture on server-side fetching

§13.2.14's call is defensible for user-initiated, rate-limited, single-page fetches, but it is a founder's judgment call about someone else's content, not an engineering one, and it changes materially if W13/W14 ever bulk-imports. Flagged, not blocking.

#### 13.5.11 Lambda concurrency quota, still at 10

§12.5.4's standing note. W7 adds 2–3 more functions. Nothing in W7 depends on the quota landing — S12's 20 sequential test parses will not approach it — but a naive "parse 20 recipes in parallel" measurement script would.

#### 13.5.12 S1 result — JSON-LD coverage spike (R2): 15/20 present, 14/20 usable — D10's middle tier fires

**The 20 sites** were picked by the founder per S1's own method (a mix of large SEO-optimized national blogs and deliberately smaller/regional/language-specific ones, so the number isn't flattered by only sampling sites that would obviously pass): Hebbar's Kitchen, Sanjeev Kapoor, Cook With Manali, Dassana's Veg Recipes of India, Archana's Kitchen, Indian Healthy Recipes (Swasthi's), Ministry of Curry, Whiskaffair, Spice Up The Curry, Padhuskitchen, My Tasty Curry, Vegecravings, Nishamadhulika, Vah Rehvah, Rak's Kitchen, Kannamma Cooks, Chitra's Food Book, Bong Eats, Maayeka, Cookilicious.

**Method, as run:** one real recipe page fetched per site (`curl`, a real browser User-Agent, `-L` for redirects), not the homepage — a homepage-link-discovery pass first found a working recipe-page URL per site (three sites — `whiskaffair`, `rakskitchen`, `kannammacooks` — needed a `www.`-prefix fix to the discovery script's host-matching; `rakskitchen` also needed browser-like headers to get past a bot block that a bare `curl` User-Agent tripped; `archanaskitchen`'s recipe grid turned out to be entirely client-side-fetched, so its URL was found via a direct guess against the site's own URL convention instead of homepage scraping). Every `<script type="application/ld+json">` block was extracted and JSON-parsed (`strict=False` — a real, necessary fix: several sites' JSON-LD embeds literal newline characters inside string values, which is invalid per strict JSON but every browser and every real-world JSON-LD consumer parses leniently, so a strict parser would undercount sites that are, in practice, fine), then walked (including through `@graph` wrappers) for any node whose `@type` contains `"Recipe"`.

**The two numbers, exactly as D10 defined them:**

| | Count | Sites |
|---|---|---|
| **(a) ld+json present, `@type` includes Recipe** | **15/20** | hebbarskitchen, cookwithmanali, vegrecipesofindia, archanaskitchen, indianhealthyrecipes, ministryofcurry, whiskaffair, spiceupthecurry, vegecravings, nishamadhulika, rakskitchen, kannammacooks, bongeats, maayeka, cookilicious |
| **(b) usable draft** (title + ≥1 ingredient + ≥1 step) | **14/20** | all of (a) except **bongeats** |
| Neither | **5/20** | sanjeevkapoor, padhuskitchen, mytastycurry, chitrasfoodbook, vahrehvah |

**Why each of the 6 non-(b) sites failed, specifically** (this is the real coverage-gap data S4/S5 and the fallback UX are built against, not just a number):

- **sanjeevkapoor, padhuskitchen, mytastycurry, chitrasfoodbook** — ld+json present (Yoast-style `Article`/`WebPage`/`BreadcrumbList` schema), but genuinely **no `Recipe`-typed node anywhere in the graph** on the specific page fetched. Not a bug: these are real pages (a roundup post on padhuskitchen, a non-recipe-tagged post on mytastycurry/chitrasfoodbook, and — notably — one of India's most prominent recipe brands, sanjeevkapoor.com, simply not tagging individual recipe pages with `Recipe` schema at all).
- **vahrehvah** — a pure client-side React/Vite SPA (`<div id="root"></div>`, confirmed on both the homepage and a direct recipe URL). A server-side fetcher — which is exactly what `importRecipeFromUrl` is — sees empty HTML, full stop. No amount of JSON-LD-parser sophistication fixes this; it needs a headless-browser render, explicitly out of scope (§13.2.12's "LLM-parsing-the-HTML is out of scope" reasoning applies here even more directly, since there's no HTML to parse at all).
- **bongeats** — the one **false-positive-shaped** result: a genuine `Recipe`-typed node, title/yield/image/durations all present and well-formed, but `recipeIngredient`/`recipeInstructions` are both **empty arrays**. Bong Eats is a video-recipe site; its structured data appears to describe the recipe's metadata without ever populating the text fields, likely because the actual ingredients/steps are presented as video content, not text. `S4`'s parser must treat "Recipe node present, both content arrays empty" as **not usable**, not as a partial draft to show the user — reflected in the exit-criteria bullet below.

**One caveat inside the 14/20, found by inspecting actual field content, not just presence:** `nishamadhulika` structurally passes (`recipeIngredient`/`recipeInstructions` both non-empty strings) but the actual values are **placeholder text** — `recipeIngredient: "Available in post please open the link"`, `recipeInstructions: "Prepare the ingredients"` — not real recipe content. D10's own definition ("title + ≥1 ingredient + ≥1 step") is a structural test, not a content-quality one, so this fixture correctly counts toward 14/20 by the rule as written — but it's recorded here because it's a real, concrete case S4 needs a RED test for: a structurally-valid draft whose actual content is useless. **New S4 RED test, added by this finding:** a recipe whose `recipeIngredient`/`recipeInstructions` are present but match an obvious placeholder/redirect pattern (single short sentence referencing "the post"/"the link"/"see above" with no measurement or verb-led instruction) should not silently pass through as a clean draft — flag it the same way `raw`-only unparseable ingredients are already flagged, not hidden from S7's "proposed" UI.

**D10's rule fires: 14/20 lands in the 10–15/20 tier.** Per the pre-committed rule (§13.2.11): **S4 and S5 are not cut** — the JSON-LD parser and `importRecipeFromUrl` resolver both ship as planned this week — but **S9's URL import screen gives the copy-paste path (routing into S10's freeform input) equal visual prominence**, not a buried fallback link, since a real ~30% of pasted URLs (and the `nishamadhulika`-shaped placeholder case pushes the *meaningfully* usable rate a little lower still) won't produce a usable draft. Reflected directly in S4/S5/S9's own slice text above, not just here.

**Fixtures:** all 20 fetched pages' `application/ld+json` script block(s) (verbatim, unmodified JSON) are committed at `api/test/fixtures/jsonld/*.html`, trimmed to a minimal HTML wrapper around just those script tags (280 KB total across 20 files) rather than the full multi-hundred-KB pages — small, static, and exactly what S4's suite needs, per this slice's own "the saved fixtures are the deliverable that outlives the spike" framing. Each fixture's header comment records its source URL and fetch date (2026-08-28) for provenance; none of the 20 pages' surrounding content (styling, images, prose, ads) is redistributed.

### 13.6 W7 exit criteria

- [x] **R2 resolved:** top-20 Indian blog JSON-LD coverage measured and written up as **two** numbers — ld+json-present (15/20) and usable-draft (14/20) — against the ≥16/20 gate; D10's 10–15/20 middle tier fired (S1, §13.2.11, §13.5.12)
- [ ] **R1 recorded as moot for W7, not silently dropped:** §6's R1 row annotated with D11's provider deviation and the reason the Bedrock ap-south-1 spike was cut, plus SD §15.1 annotated "not exercised in W7; still open for any future Bedrock week" (§13.1, §13.2.2, S12)
- [ ] **D11's provider deviation recorded in SD §18** with its rationale, its cost figures, the explicit statement that **W15/W17/W18/W19's provider choice remains open**, and the note that `network-stack.ts`'s `BEDROCK_RUNTIME` endpoint was deliberately left untouched (S2/S12)
- [x] Real-world HTML fixtures from the 20 blogs committed under `api/test/fixtures/jsonld/` (20 files, 280 KB total, trimmed to the ld+json script blocks + minimal wrapper) and driving S4's suite (S1/S4)
- [ ] `invokeModel` shipped with §13.2.7's full contract — one deadline, two separately-bounded retry chains, six error codes — with **`AI_DEADLINE_MS` set from S2's own measured p50/p95, not from the 20,000 ms estimate**, and the measurement recorded (S2, §13.2.7)
- [ ] The Gemini API key lives in Secrets Manager, is fetched at cold start and cached per container following the existing `APP_ROLE_SECRET_ARN` pattern, is **never** in CDK source, an env var value, a log line, or a client-facing error, and `secretsmanager:GetSecretValue` is scoped to that one ARN — asserted by a fine-grained CDK test (S2)
- [ ] The AI and URL Lambdas are non-VPC with no `lambdaSecurityGroup` and no `appRoleSecret` access, asserted by a fine-grained CDK test; `network-stack.ts`'s snapshot is unchanged (D3, S2)
- [ ] `RecipeDraft`/`RecipeIngredientDraft` in `shared/schema.graphql` and re-synced into SD §6.1, with the deviation from §6.1's `Recipe!` return recorded and its rationale (D1, S3/S12)
- [ ] Both parse mutations drop `householdId`, and **the deliberate absence of a membership check is asserted by a named test** rather than merely being true (D3, S3/S5)
- [ ] `parseFreeformRecipe` live on dev, rate-limited at 20/day via the **existing** `checkAndIncrementDailyAction`, rejecting >4,000-char input **without a provider call**, and returning a valid `RecipeDraft` for a real pasted recipe — the DoD gate's "freeform AI returns valid JSON" (S3)
- [ ] Malformed model output → one reinforcement retry → `AI_UNPARSEABLE`, asserted by a named test (`DEV_WORKFLOW.md` §3.2's mandated AI RED test) (S2/S3)
- [ ] **The rate limit is consumed exactly once per user-initiated call regardless of internal retries**, asserted by a named test and reviewed as a cost control (D7/D8, §13.2.9, S2)
- [ ] Unknown enum values from the model degrade one field with a warning rather than failing the parse; structural and bounds violations still fail hard (D4, S2/S3)
- [ ] `importRecipeFromUrl` live on dev with the full §13.2.10 SSRF control set, **including redirect-hop revalidation**, each control covered by its own RED test, and `security-reviewer` clean against that explicit checklist (S5) — *or* formally cut per D10 with the cut recorded and the paste-assist shipped in its place
- [ ] `createRecipe` accepts `source` attribution, persists `sourceType: url|freeform_ai` + `sourceUrl`, **rejects client-claimed `curated`/`ai`**, and every W6 `createRecipe` test still passes unmodified (D2, S6)
- [ ] `AIProposal` built and covered; proposed-vs-confirmed is distinguishable and asserted via semantics (S7)
- [ ] Wireframes 8.1, 8.3, 8.4, 8.5, 12.1 shipped → **27/49** (S8–S11)
- [ ] An AI-proposed `role` cannot reach `createRecipe` without an affirmative user confirmation — W6's D1 still holds through the AI path, asserted by a named test (D5, S10)
- [ ] The Freeform/URL review screen is a seeded wrapper over W6's `RecipeFormScreen`, not a second form implementation (D6, S10)
- [ ] Every failure path preserves the user's pasted text or entered URL; the fallback screen always offers a seeded manual form (S11) — SD §14's "manual entry always available", made real
- [ ] SD §14's four AI failure rows replaced by §13.2.7's error-code table, and `graphql_error_mapper.dart` branches on codes, never on message text (S11/S12)
- [ ] Every nullable argument tested with an explicit `null`, not only an absent key (§11.5.5's regression class, all backend slices)
- [ ] Every backend slice verified against real dev AWS, not synth — including **one real Gemini call from the deployed non-VPC Lambda** (proving the Secrets Manager fetch and public egress both work), one real URL import against a live blog, and one deliberate SSRF attempt against the **deployed** endpoint (S12)
- [ ] **20 freeform parses measured** against PRD §11's "≥80% accepted with ≤3 edits", with the 20 test inputs fixed and kept for future re-measurement against a later prompt or provider (S12, §13.5.8)
- [ ] `RUNBOOK.md` carries the Gemini API key rotation procedure — new operational surface this week (S12)
- [ ] Coverage: Lambda ≥80% (enforced in CI since W5); Flutter domain+state ≥80% — re-measured, not assumed (S12)
- [ ] `security-reviewer` clean on S2, S3, S4, S5, S6 (per-slice triggers; **no phase-boundary sweep this week** — W8 is the §2.3 boundary)
- [ ] §4's W7 row has actual hours (per-slice merge-timestamp wall-clock, the W6 method) and carry-over notes; §6's R1 and R2 rows updated; SD §15 item 4 marked resolved and §15.1 annotated
- [ ] **Carried, not inherited — still W6's, still open:** the physical-device two-device `onRecipeChanged` run (`RUNBOOK.md` §3) and the R7 300-item scroll spike on real low-end Android hardware (§12.5.5/§12.5.6). Neither blocks W7; both should be scheduled before W8 closes Phase 2

### 13.7 W7 planning decisions (final, locked 2026-08-28)

| # | Question | **Locked decision** |
|---|---|---|
| D1 | §13.2.3 — SD §6.1 returns `Recipe!` from both parse mutations, which cannot represent an unsaved draft. New `RecipeDraft` type, or force-fit `Recipe!`? | **New `RecipeDraft`/`RecipeIngredientDraft` SDL types.** `Recipe` has ten non-null fields a draft has no honest value for, and returning it hands every client cache and mapper something structurally indistinguishable from a persisted row. Recorded as an SD §6.1 deviation. |
| D2 | §13.2.4 — how does "confirm" write provenance, given `createRecipe` hardcodes `sourceType: 'user'` and can't write `sourceUrl`? | **Optional `source: RecipeSourceAttribution` argument on `createRecipe`**; the client re-sends `sourceType` + `sourceUrl` at confirm time. `curated`/`ai` rejected server-side. **Not** a server-side DynamoDB draft token — that is more truthful about provenance but adds a stateful round trip and an expiry UX to protect a low-stakes self-reported label inside one household. |
| D3 | §13.2.1 — the VPC has `natGateways: 0`, so an internet-touching resolver has no route out. Non-VPC Lambda (loses the membership check), NAT (~$32–45/mo, blows the cost DoD), or a proxy-Lambda hop? | **Non-VPC for BOTH `importRecipeFromUrl` AND `parseFreeformRecipe`, with `householdId` dropped from both signatures** rather than accepting an argument we cannot authorize. Modified from the draft's "decide `parseFreeformRecipe` separately after the Bedrock spike" by D11: neither provider has an AWS PrivateLink/interface-endpoint story, so VPC attachment buys nothing for either. Per-user daily rate limits (D8) are the real abuse control. |
| D4 | §13.2.5 — Zod on model output: hard-fail everything, or coerce unknown enum values with a warning and hard-fail only structure/bounds? | **Asymmetric — hard-fail on structure and bounds, coerce-with-warning on unrecognised enum values.** Mirrors §12.2.6's read-side handling exactly ("one bad row degrades one field, never the whole query"). Failing an 80%-correct parse over a cuisine label is the easiest way to miss PRD §11's acceptance target for a non-quality reason. |
| D5 | §13.2.6 — does an AI-proposed `role` violate W6 D1's "no default anywhere"? | **Propose in a visually distinct "proposed" state; submit stays blocked until the user affirmatively confirms or changes it.** W6's D1 still holds in full — **no recipe can save with a role nobody actively chose.** Generalises to W18/W19's proposal reviews. |
| D6 | §13.3 S10 — is Freeform/URL review a new screen, or a seeded wrapper over W6's `RecipeFormScreen`? | **Seeded wrapper — third use of the §11.2.7 seeded-form-reuse pattern**, with a "proposed" badge/highlight on AI-filled fields until the user touches them (which is also what D5 requires). A second dynamic-list form implementation is the most expensive way to ship this and guarantees the two drift. |
| D7 | §13.2.7 — approve the concrete AI failure contract: deadline, retry chains, error codes, rate-limit accounting? | **Approved as specified:** one shared deadline (**20s — an ESTIMATE, to be validated empirically by S2's own ten measured calls and set from that data before S2 merges**, since the spike that would have pre-verified it is cut); ≤2 transport retries; exactly 1 reinforcement retry on invalid/malformed JSON; six distinct error codes; and **the rate limit consumed exactly ONCE per user-initiated call regardless of internal retries.** AppSync's 30s ceiling makes SD §14's unbounded "backoff 3×" unimplementable as written. |
| D8 | §13.2.9 — rate-limit action names and caps. | **`'freeformParse'` at 20/day per user** (SD §8.5, already locked) and **`'urlImport'` at 30/day per user** (new). `'photoPantry'`, `'cookFromPantry'`, `'staplesNote'` reserved now while none are live — the limiter's own doc treats these as frozen production keys. **Stated explicitly rather than left implicit: with the $5/day CloudWatch alarm deferred to W17/W22, these caps are THE actual preventive cost control shipping this week**, not a formality and not defence-in-depth on top of something else. |
| D9 | §13.5.1 — ~24.0 hrs against ~10, with the §7 buffer already fully claimed by W6's D8. | **Accept a multi-week W7 at FULL scope**, consistent with W5/W6. **Deferring URL import to W8 was considered and explicitly rejected — S4, S5 and S9 stay in W7.** URL import is committed this week; the only thing that can remove it is D10's measured quality gate, never schedule pressure. |
| D10 | §13.2.11 — pre-commit the R2 decision rule *before* the JSON-LD spike runs: what happens at ≥16, 10–15, and <10 out of 20 usable drafts? | **Pre-committed, three tiers.** ≥16/20 → ship URL import as the **primary** path. 10–15/20 → ship it, but promote copy-paste to **equal visual prominence**, not a buried fallback. <10/20 → **cut S4, S5 and S9 entirely** and ship copy-paste-only this week, with those three slices **marked CUT and the reason recorded** (matching this codebase's record-deviations-don't-silently-omit convention, e.g. W6 S8's `recipe_form_entry.dart` note) rather than deleted from the plan. |
| D11 | §13.2.2 — which AI provider does W7 use, given SD/PRD assume Bedrock everywhere? | **Gemini 2.5 Flash, for both `parseFreeformRecipe` and the freeform-fallback path off a failed URL import.** A scoped, recorded **deviation** from SD §6 R1 / WS-7 / SD §8.2/§8.4 / SD §15.1's Bedrock assumption. Cascades: the Bedrock ap-south-1 spike is **CUT** and §6 R1 is **moot for W7**; §6 R2 is unchanged; the invocation layer becomes provider-neutral `invokeModel` over a `geminiClient` adapter; auth becomes an API key in Secrets Manager following the existing `parimaan/google-oauth-secret` + `APP_ROLE_SECRET_ARN` patterns, **not** IAM; no VPC endpoint work, and `network-stack.ts`'s idle `BEDROCK_RUNTIME` endpoint is deliberately left untouched. Cost: $0.30/M in, $2.50/M out → **≈$0.0022/parse vs ≈$0.005 on Haiku**, against **$300 of pre-existing Gemini credit** that covers W7's entire realistic usage. **The provider choice for W15/W17/W18/W19 is EXPLICITLY LEFT OPEN** and is not decided here. |

---
