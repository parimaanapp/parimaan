# Parimaan — System Design

**Version:** 0.1
**Owner:** Amogh Kulkarni
**Last updated:** 2026-07-29
**Status:** Draft — pending review
**Companion to:** [PRD v0.3](./PRD.md)

---

## 1. Overview

This document turns the PRD into a buildable system: how the pieces fit together, what talks to what, what's stored where, what fails when things go wrong, and what a solo developer actually deploys.

Design goals, in priority order:

1. **Correctness under multi-user editing.** Households share data live; two people writing to the same shopping list must not lose data.
2. **Cost discipline.** Every choice is measured against §17 of the PRD (~$25–35/mo at beta scale).
3. **Solo-developer operability.** Nothing here should require a 24×7 on-call rotation. Prefer managed services and generous timeouts.
4. **Room to grow.** The schema and API should survive v1.1 (roles, ingredient normalization, receipt OCR) without rewrites.

---

## 2. Baseline decisions (flag to push back before we bake these in)

| Decision | Choice | Alternative | Reason |
|---|---|---|---|
| **AWS region** | `ap-south-1` (Mumbai) primary | `us-east-1` | Data residency for India-first users; ~30ms latency wins for beta households. |
| **Bedrock region** | `ap-south-1` if Claude models available; else `us-east-1` cross-region | Direct Anthropic API | Verify model availability first week of month 5. |
| **Environments** | `dev` + `prod` only | + `staging` | Solo dev overhead; use feature flags in prod for staged rollout. |
| **Repo layout** | Monorepo | Multi-repo | Shared types between Flutter, web, and Lambda; easier atomic changes. |
| **Backend runtime** | Node.js 20 + TypeScript on Lambda | Python | Type sharing with web + shared validation schemas. |
| **IaC** | AWS CDK v2 in TypeScript | SAM, Terraform | Same language as Lambda; per-construct testability. |
| **CI/CD** | GitHub Actions | CodePipeline | Free tier, familiar. |
| **DB migrations** | `node-pg-migrate` | Prisma Migrate, Sqitch | Lightweight, no ORM lock-in. |
| **GraphQL client (Flutter)** | `ferry` (codegen) | `graphql_flutter` | Type-safe generated Dart from SDL. |
| **GraphQL client (web)** | `urql` | Apollo Client | Smaller bundle, subscriptions supported. |
| **Push notifications** | FCM (Firebase Cloud Messaging) | AWS Pinpoint | FCM is free; Pinpoint charges. |

Push back on any of these before we bake them into CDK stacks in month 1.

---

## 3. Architecture at a glance

```mermaid
flowchart TB
  subgraph Clients
    iOS[Flutter iOS]
    Android[Flutter Android]
    Web[Next.js Web]
  end

  subgraph Edge
    CF[CloudFront]
  end

  subgraph AuthLayer["Auth"]
    Cognito[Cognito User Pool<br/>Google IdP]
  end

  subgraph API["API Layer"]
    AppSync[AppSync<br/>GraphQL + Subscriptions]
    Resolvers[Lambda Resolvers<br/>Node.js 20]
  end

  subgraph AILayer["AI"]
    Bedrock[Bedrock<br/>Claude Sonnet + Haiku]
  end

  subgraph Data["Data"]
    Aurora[(Aurora Serverless v2<br/>Postgres)]
    S3Photos[S3: photos]
    S3Exports[S3: list exports]
    DDBCache[(DynamoDB<br/>AI response cache + rate limits)]
  end

  subgraph OpsLayer["Ops"]
    CW[CloudWatch<br/>Logs + Metrics + Alarms]
    Xray[X-Ray]
    PostHog[PostHog<br/>Product Analytics]
  end

  subgraph External["External"]
    FCM[Firebase Cloud Messaging]
    Google[Google OAuth]
  end

  iOS & Android & Web --> CF
  CF --> AppSync
  iOS & Android & Web --> Cognito
  Cognito --> Google
  AppSync --> Resolvers
  Resolvers --> Aurora
  Resolvers --> Bedrock
  Resolvers --> S3Photos
  Resolvers --> S3Exports
  Resolvers --> DDBCache
  Resolvers --> FCM
  Resolvers --> CW
  Resolvers --> Xray
  iOS & Android & Web -.->|events| PostHog
```

---

## 4. Component responsibilities

| Component | Responsibility | Not responsible for |
|---|---|---|
| **Flutter mobile** | UI, local read-cache, image compression, GraphQL calls, FCM registration | Auth token issuance, business logic beyond field validation |
| **Next.js web** | Read + limited edit UI, household admin, mirror of GraphQL API | Real-time meal-plan editing (v1.1) |
| **Cognito** | User authentication via Google, JWT issuance, token refresh | Household membership, authorization decisions |
| **AppSync** | GraphQL entrypoint, subscription fanout, JWT validation, resolver invocation | Business logic |
| **Lambda resolvers** | Query/mutation logic, authorization checks (householdId ∈ user's memberships), Bedrock calls, DB writes, S3 presigned URLs | UI concerns |
| **Aurora Postgres** | System of record for all household data | Blob storage, cache |
| **S3 (photos)** | Pantry/recipe photo storage, uploaded via presigned URLs | List image generation (that's Lambda) |
| **S3 (exports)** | Generated shopping list images, 30-day lifecycle | |
| **DynamoDB** | AI response cache (TTL), per-user AI rate limits | Anything relational |
| **Bedrock** | Claude Sonnet (vision + complex text), Claude Haiku (freeform parse, staples note) | Prompt storage — prompts live in code |
| **FCM** | Push delivery to iOS + Android | Notification preferences (those live in Postgres) |
| **PostHog** | Product analytics, feature flags, session replay | Auth, business data |
| **CloudWatch + X-Ray** | Logs, metrics, distributed traces, alarms | Application-level debugging tools |

---

## 5. Key data flows

### 5.1 Auth — Google SSO via Cognito

```mermaid
sequenceDiagram
  participant U as User
  participant App as Flutter/Web
  participant Cog as Cognito Hosted UI
  participant G as Google OAuth
  participant AS as AppSync
  participant L as Lambda (userProfile)
  participant DB as Postgres

  U->>App: Tap "Sign in with Google"
  App->>Cog: OAuth start (PKCE)
  Cog->>G: Redirect to Google consent
  G->>Cog: authcode
  Cog->>App: id_token + access_token + refresh_token
  App->>AS: query me { ... } (Bearer id_token)
  AS->>L: invoke with claims
  L->>DB: upsert users row on first login
  L->>DB: fetch memberships
  L-->>AS: user + households
  AS-->>App: response
```

Notes:
- First login triggers user row creation server-side (Cognito holds identity; our `users` table holds display data).
- Refresh happens transparently via Cognito SDK.
- No password path in MVP; only Google IdP is configured.

### 5.2 Household create → invite → join

```mermaid
sequenceDiagram
  participant P as Primary User
  participant M as Member
  participant App as Flutter
  participant AS as AppSync
  participant L as Lambda
  participant DB as Postgres

  P->>App: Create household "Kulkarnis"
  App->>AS: createHousehold(name)
  AS->>L: createHousehold
  L->>DB: insert households (primary_user_id = me)
  L->>DB: insert household_memberships (role='primary')
  L->>DB: insert household_settings (defaults)
  L->>L: generate 6-char invite code
  L->>DB: update households.invite_code
  L-->>App: household + code
  P->>M: share code out-of-band (WhatsApp, etc.)
  M->>App: Join household, enter code
  App->>AS: joinHousehold(code)
  AS->>L: joinHousehold
  L->>DB: SELECT household by code
  L->>DB: check count(members) < 5
  L->>DB: insert household_memberships (role='member')
  L-->>App: household details
  AS-->>P: subscription onHouseholdMembershipChanged fires
```

### 5.3 Weekly meal plan generation

```mermaid
sequenceDiagram
  participant P as Planner
  participant App as Flutter
  participant AS as AppSync
  participant L as Lambda (autoFillWeek)
  participant DB as Postgres

  P->>App: Tap "Auto-fill week"
  App->>AS: autoFillWeek(menuId)
  AS->>L: autoFillWeek
  L->>DB: fetch settings (meal_structure, cuisine prefs)
  L->>DB: fetch recipes WHERE household_id=X AND in_rotation=true
  L->>DB: fetch existing menu_items
  L->>L: for each (day, meal) empty slot:<br/>  pick recipes by role,<br/>  respect MAX caps,<br/>  avoid recent repeats,<br/>  weight by cuisine prefs
  L->>DB: insert menu_items (batch, transactional)
  L-->>AS: updated menu
  AS-->>App: response
  AS-->>App: subscription onMenuChanged fires to other household members
```

### 5.4 Photo pantry AI

```mermaid
sequenceDiagram
  participant U as User
  participant App as Flutter
  participant AS as AppSync
  participant L1 as Lambda (getUploadUrl)
  participant S3 as S3 photos bucket
  participant L2 as Lambda (analyzePantryPhoto)
  participant BR as Bedrock (Sonnet)
  participant DDB as DynamoDB rate-limit
  participant DB as Postgres

  U->>App: Snap photo
  App->>App: downscale to 1024px, JPEG q80
  App->>AS: getPantryPhotoUploadUrl
  AS->>L1: getPantryPhotoUploadUrl
  L1-->>App: presigned PUT URL
  App->>S3: PUT image
  App->>AS: analyzePantryPhoto(s3Key)
  AS->>L2: analyzePantryPhoto
  L2->>DDB: check rate limit (per user/day)
  DDB-->>L2: OK
  L2->>S3: GET image
  L2->>BR: InvokeModel (Sonnet, vision)
  BR-->>L2: proposed items JSON
  L2->>L2: validate JSON against schema, retry once on failure
  L2-->>AS: [{name, qty, unit, category}, ...]
  AS-->>App: proposed items
  U->>App: Review + edit + confirm
  App->>AS: bulkAddPantryItems(items)
  AS->>DB: insert pantry_items
  AS-->>App: success
  AS-->>otherMembers: subscription onPantryChanged
```

### 5.5 Real-time household sync

```mermaid
sequenceDiagram
  participant A as User A
  participant B as User B
  participant AppA as Flutter (A)
  participant AppB as Flutter (B)
  participant AS as AppSync

  AppA->>AS: subscribe onPantryChanged(householdId)
  AppB->>AS: subscribe onPantryChanged(householdId)
  Note over AS: WebSocket connection maintained
  A->>AppA: mark "milk" purchased
  AppA->>AS: markPurchased(itemId)
  AS->>AS: resolver: verify user ∈ household
  AS->>AS: mutation succeeds
  AS-->>AppA: response
  AS-->>AppB: subscription event (payload)
  AppB->>AppB: update local state
```

**Subscription strategy:**
- One subscription topic per (household, entity-type): `onPantryChanged(householdId)`, `onMenuChanged(householdId)`, `onShoppingListChanged(householdId)`, `onSettingsChanged(householdId)`
- Client subscribes on foreground, unsubscribes on background
- Reconnect with backoff on drop; on reconnect, re-fetch full state

### 5.6 Freeform recipe parse

```mermaid
sequenceDiagram
  participant U as User
  participant App as Flutter
  participant L as Lambda (parseFreeformRecipe)
  participant BR as Bedrock (Haiku)
  participant DB as Postgres

  U->>App: paste "mom's rajma recipe..."
  App->>L: parseFreeformRecipe(text)
  L->>BR: InvokeModel (Haiku, JSON mode)
  BR-->>L: {title, ingredients[], steps[], role, cuisine, dietary_tags}
  L->>L: validate against JSON schema
  L-->>App: structured recipe (draft)
  U->>App: review, edit any field, save
  App->>L: createRecipe(input)
  L->>DB: insert recipes + recipe_ingredients
```

### 5.7 "Have it" during shopping list review

```mermaid
sequenceDiagram
  participant U as User
  participant App as Flutter
  participant L as Lambda (haveIt)
  participant DB as Postgres

  U->>App: tap "Have it" on 'atta 1kg'
  App->>U: prompt quantity (default 1kg)
  U->>App: confirm 2kg
  App->>L: haveIt(itemId, quantity)
  L->>DB: BEGIN TX
  L->>DB: upsert pantry_items (add or increment)
  L->>DB: update shopping_list_items SET moved_to_pantry=true, purchased=true
  L->>DB: COMMIT
  L-->>App: updated list + pantry
```

---

## 6. AppSync GraphQL API

### 6.1 Schema (SDL, MVP subset)

```graphql
scalar AWSDateTime
scalar AWSJSON
scalar AWSDate

# ---------- Types ----------

type User {
  id: ID!
  email: String!
  displayName: String
  avatarUrl: String
  households: [HouseholdMembership!]!
}

type Household {
  id: ID!
  name: String!
  inviteCode: String!
  primaryUserId: ID!
  members: [HouseholdMembership!]!
  settings: HouseholdSettings!
  subscriptionStatus: SubscriptionStatus!
}

type HouseholdMembership {
  id: ID!
  household: Household!
  user: User!
  role: HouseholdRole!
  joinedAt: AWSDateTime!
}

enum HouseholdRole { primary member }
enum SubscriptionStatus { free trial active past_due cancelled }

type HouseholdSettings {
  householdId: ID!
  mealsEnabled: [MealType!]!
  mealStructure: AWSJSON!   # {lunch: {carb: 1, sabzi_dal: 2, accompaniment: 1}, ...}
  cuisineTier1: [CuisineTier1!]!
  cuisineTier2Weights: AWSJSON! # {punjabi: "more", ...}
  dietaryTags: [DietaryTag!]!
  allergens: [String!]!
  skipIngredients: [String!]!
}

enum MealType { breakfast lunch snacks dinner }
enum CuisineTier1 { north_indian south_indian pan_india indo_chinese continental }
enum DietaryTag { veg vegan jain eggetarian gluten_free dairy_free }
enum RecipeRole { breakfast carb sabzi_dal accompaniment snack sweet drink }
enum RecipeSource { user url curated ai freeform_ai }

# SHIPPED W7 S6 (§13.2.4 D2). sourceType is restricted server-side (Zod,
# not the GraphQL enum itself) to url/freeform_ai only when source is
# present at all — curated (W13/W14 seeder) and ai (a future
# cook-from-pantry feature) are server-owned values a client can never
# claim through this argument. sourceUrl is required iff sourceType: url.
input RecipeSourceAttribution { sourceType: RecipeSource! sourceUrl: String }

type Recipe {
  id: ID!
  householdId: ID!
  sourceType: RecipeSource!
  sourceUrl: String
  title: String!
  description: String
  servings: Int!
  prepMin: Int
  cookMin: Int
  cuisineTier1: CuisineTier1
  cuisineTier2: String
  dietaryTags: [DietaryTag!]!
  role: RecipeRole!
  inRotation: Boolean!
  isFavorite: Boolean!
  # Resolved by a separate field resolver (W6 S2, E2E_MVP_PLAN.md §12.2.7) —
  # Query.recipes never hydrates this inline, so a Library-style query that
  # doesn't select it never pays for the join. RLS is the sole
  # authorization layer here (no householdId argument to gate on).
  ingredients: [RecipeIngredient!]!
  steps: [String!]!
  # Added W6 S2 (§12.2.8) — this block originally had neither field.
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

type RecipeIngredient {
  id: ID!
  name: String!
  quantity: Float
  unit: String
  category: String
  notes: String
  isStaple: Boolean!
}

# SHIPPED W7 S3 (E2E_MVP_PLAN.md §13.2.3 D1). An UNSAVED, UNPERSISTED
# proposal produced by `parseFreeformRecipe` (and, later, S5's
# `importRecipeFromUrl`) — deliberately NOT a `Recipe`: no id, no
# householdId, no timestamps, so it can't be mistaken for a stored row by
# any client cache or mapper. Nothing is written until the user confirms
# and the client calls `createRecipe` with a `source` attribution.
type RecipeDraft {
  title: String
  description: String
  servings: Int
  prepMin: Int
  cookMin: Int
  cuisineTier1: CuisineTier1
  cuisineTier2: String
  dietaryTags: [DietaryTag!]!
  role: RecipeRole   # NULLABLE and unconfirmed (§13.2.6 D5) — an AI-proposed
                      # role does not satisfy W6 D1's "role assignment
                      # required"; the user must still affirmatively confirm
                      # or change it before createRecipe.
  ingredients: [RecipeIngredientDraft!]!
  steps: [String!]!
  sourceUrl: String   # set by importRecipeFromUrl (S5); always null for parseFreeformRecipe
  warnings: [String!]! # e.g. an unrecognised cuisineTier1 dropped, not a
                        # parse failure (§13.2.5 D4) — never an error channel
}

type RecipeIngredientDraft {
  raw: String!   # the original, unmodified source string/reconstruction —
                  # kept verbatim so nothing the parser couldn't decompose is lost
  name: String!
  quantity: Float
  unit: String
  notes: String
}

type PantryItem {
  id: ID!
  householdId: ID!
  name: String!
  quantity: Float!
  unit: String!
  category: String
  isStaple: Boolean!
  # AWSDate, not AWSDateTime (deviation, W5 S2 — E2E_MVP_PLAN.md §11.2.5):
  # the underlying column is a plain SQL DATE, and AWSDateTime would attach
  # a spurious time-of-day and timezone no user chose.
  expiryDate: AWSDate
  lowThreshold: Float
  addedBy: ID!
  addedAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

# No `addedBy` field — always the verified caller, never client-supplied
# (W5 S2).
input PantryItemInput {
  name: String!
  quantity: Float!
  unit: String!
  category: String
  isStaple: Boolean
  expiryDate: AWSDate
  lowThreshold: Float
}

type Menu {
  id: ID!
  householdId: ID!
  weekStartDate: AWSDateTime!
  items: [MenuItem!]!
}

type MenuItem {
  id: ID!
  menuId: ID!
  recipe: Recipe!
  dayOfWeek: Int!
  mealSlot: MealType!
  slotRole: RecipeRole!
  servingsOverride: Int
  madeAt: AWSDateTime
}

type ShoppingList {
  id: ID!
  householdId: ID!
  generatedFromMenuId: ID
  createdAt: AWSDateTime!
  closedAt: AWSDateTime
  aiStaplesNote: String
  items: [ShoppingListItem!]!
}

type ShoppingListItem {
  id: ID!
  name: String!
  quantity: Float
  unit: String
  category: String
  sourceRecipeId: ID
  purchased: Boolean!
  purchasedBy: ID
  purchasedAt: AWSDateTime
  movedToPantry: Boolean!
}

# ---------- Queries ----------

type Query {
  me: User!
  household(id: ID!): Household!
  pantry(householdId: ID!, search: String, category: String): [PantryItem!]!
  recipes(householdId: ID!, role: RecipeRole, isFavorite: Boolean): [Recipe!]!
  # Added W6 S7 (deviation, approved mid-slice — E2E_MVP_PLAN.md §12.2's S7
  # entry): not in the original D3 signature set. The Detail screen needs
  # one recipe (with `ingredients`) without re-fetching the whole
  # household's list. No `householdId`; RLS alone gates it, same id-only
  # pattern as `updateRecipe`/`deleteRecipe`. Nonexistent id and another
  # household's id both deny identically.
  recipe(id: ID!): Recipe!
  menu(householdId: ID!, weekStartDate: AWSDateTime!): Menu
  shoppingList(householdId: ID!, id: ID): ShoppingList
  cookFromPantry(householdId: ID!, vibe: String): [Recipe!]!   # AI
}

# ---------- Mutations ----------

type Mutation {
  # Household
  createHousehold(name: String!): Household!
  joinHousehold(inviteCode: String!): Household!
  rotateInviteCode(householdId: ID!): Household!
  leaveHousehold(householdId: ID!): Boolean!
  # Returns Household!, not HouseholdSettings! (W8 S10, E2E_MVP_PLAN.md
  # §14.2.10 D4 — widened so it can attach to Subscription.onHouseholdChanged
  # below; settings remain reachable via Household.settings).
  updateHouseholdSettings(householdId: ID!, input: HouseholdSettingsInput!): Household!

  # Pantry
  addPantryItem(householdId: ID!, input: PantryItemInput!): PantryItem!
  bulkAddPantryItems(householdId: ID!, items: [PantryItemInput!]!): [PantryItem!]!
  # PantryItemPatchInput (not PantryItemInput — its fields are all required,
  # wrong for a partial patch), and returns PantryItem!, not Boolean!
  # (W5 S3, E2E_MVP_PLAN.md §11.2.1) — a future onPantryChanged subscriber
  # needs to know *which* item vanished on delete, not just that a delete
  # happened somewhere. Neither mutation takes householdId; the item's
  # household is discovered from `id` via a query already RLS-scoped to the
  # caller's own households (see api/src/resolvers/updatePantryItem.ts).
  updatePantryItem(id: ID!, input: PantryItemPatchInput!): PantryItem!
  deletePantryItem(id: ID!): PantryItem!

  # Recipes. Shipped W6 S3 (createRecipe)/S4 (updateRecipe/deleteRecipe)/S5
  # (favoriteRecipe/setInRotation), all five live on dev — E2E_MVP_PLAN.md
  # §12.7 D3 locked the signatures ahead of implementation, and this SD
  # block matches what actually shipped rather than the schema module's own
  # original draft: `updateRecipe` takes `RecipePatchInput!`, not
  # `RecipeInput!` (a partial patch, matching `updatePantryItem`'s
  # convention — reusing the create input was wrong for the same reason
  # `PantryItemPatchInput` exists at all); `deleteRecipe` returns `Recipe!`,
  # not `Boolean!` (so a subscriber learns which recipe vanished, matching
  # `deletePantryItem`'s §11.2.1 precedent).
  # `source` argument added W7 S6 (§13.2.4 D2) — see the amendment below for
  # the full rationale; every pre-W7 caller (no `source`) is unaffected.
  createRecipe(householdId: ID!, input: RecipeInput!, source: RecipeSourceAttribution): Recipe!
  updateRecipe(id: ID!, input: RecipePatchInput!): Recipe!
  deleteRecipe(id: ID!): Recipe!
  favoriteRecipe(id: ID!, favorite: Boolean!): Recipe!
  setInRotation(id: ID!, inRotation: Boolean!): Recipe!
  # SHIPPED W7 S3, deviating from this block's own original draft (returned
  # `Recipe!`, took `householdId`) — see the identical rationale on
  # `importRecipeFromUrl` below, which deviates the same way (D1, D3,
  # E2E_MVP_PLAN.md §13.2.3/§13.2.1): a `Recipe`'s ten non-null fields (id,
  # householdId, timestamps, ...) have no honest value for an unsaved
  # proposal, and this resolver's non-VPC Lambda has no route to Aurora, so
  # it cannot run `requireHouseholdMember` — accepting `householdId` it
  # can't authorize would violate this codebase's existence-oracle
  # convention. Rate-limited at 20/day per user (`'freeformParse'`, §13.2.9
  # D8), keyed on the Cognito `sub` directly.
  parseFreeformRecipe(text: String!): RecipeDraft!                       # AI, returns an unsaved draft
  # SHIPPED W7 S5, same D1/D3 deviation as parseFreeformRecipe immediately
  # above: returns `RecipeDraft!`, takes no `householdId`. The one
  # additional control this resolver carries that parseFreeformRecipe
  # doesn't: a full SSRF gate on the user-supplied `url` before any fetch
  # (§13.2.10) — https-only, no credentials/non-default-port/IP-literal
  # host, every DNS-resolved address checked against private/reserved
  # IPv4 AND IPv6 ranges (including tunnelling/embedding forms — Teredo,
  # 6to4, NAT64, IPv4-mapped/-compatible — not just the obvious RFC1918/
  # loopback cases), at most 3 redirects with the full gate re-run on
  # every hop (closing the "public URL redirects to the cloud metadata
  # endpoint" attack), an 8s **total** budget across every hop (an
  # explicit deadline timer, not `https.request`'s own `timeout` option —
  # that option is a socket *idle* timer that a drip-feeding server can
  # reset indefinitely, not a real deadline), and a response cap aborted
  # mid-stream (1MB at ship time; raised to 5MB in W7 S12 after a real
  # S1-validated site grew past 1MB between spike and live verification —
  # RUNBOOK.md §2). A fetch failure and a "page has no usable Recipe
  # JSON-LD" parse failure both surface as the identical `URL_UNREADABLE`
  # client error — never distinguished, since revealing *why* a URL was
  # rejected would itself be an internal-network reconnaissance oracle.
  # Rate-limited at 30/day per user (`'urlImport'`, §13.2.9 D8), checked
  # (and the daily counter incremented) before any DNS lookup. This
  # Lambda deliberately has NO Gemini secret access, unlike
  # parseFreeformRecipe — it never calls the model.
  importRecipeFromUrl(url: String!): RecipeDraft!                        # fetches + parses JSON-LD, returns an unsaved draft
  analyzePantryPhoto(householdId: ID!, s3Key: String!): [PantryItemInput!]! # AI

  # Menu
  createMenu(householdId: ID!, weekStartDate: AWSDateTime!): Menu!
  addMenuItem(menuId: ID!, input: MenuItemInput!): MenuItem!
  removeMenuItem(id: ID!): Boolean!
  autoFillWeek(menuId: ID!, overwrite: Boolean!): Menu!
  markMade(menuItemId: ID!): MenuItem!

  # Shopping list
  generateShoppingList(menuId: ID!): ShoppingList!
  addShoppingListItem(listId: ID!, input: ShoppingListItemInput!): ShoppingListItem!
  markPurchased(itemId: ID!): ShoppingListItem!
  haveIt(itemId: ID!, quantity: Float!): ShoppingListItem!
  exportShoppingListImage(listId: ID!): String!    # returns presigned URL

  # Upload URL
  getPantryPhotoUploadUrl(householdId: ID!): PresignedUpload!
}

type PresignedUpload {
  url: String!
  s3Key: String!
  expiresAt: AWSDateTime!
}

# ---------- Subscriptions ----------

type Subscription {
  # This list was originally 6 mutations, 3 of which can't compile as an
  # AppSync subscription: a subscribed mutation's return type must be a
  # supertype of the subscription payload, and `bulkAddPantryItems` returns
  # `[PantryItem!]!` (a list can't fan out to one `PantryItem`), while
  # `haveIt`/`markPurchased` return `ShoppingListItem!` (wrong type, and
  # don't exist yet — W11/W12). Corrected per E2E_MVP_PLAN.md §11.2.1;
  # `bulkAddPantryItems`' own subscription coverage (`onPantryBulkChanged`
  # or a refetch) is an open W18 item, not solved here.
  #
  # `onPantryChanged` **is implemented** (W5 S8) — the first field in this
  # type to go live, authorized by a per-field Lambda resolver rather than
  # this section's stated connect-time authorizer (§10.4 deviation,
  # E2E_MVP_PLAN.md §11.2.9). `onMenuChanged`/`onShoppingListChanged` below
  # remain aspirational (W11/W12, alongside the mutations they subscribe
  # to). The pushed payload carries no event-type discriminator —
  # see E2E_MVP_PLAN.md §11.2.12 for why the mobile client treats every push
  # as "refetch", not a local add/update/delete patch — the same constraint
  # applies to every subscription field in this type, not just this one.
  onPantryChanged(householdId: ID!): PantryItem
    @aws_subscribe(mutations: ["addPantryItem", "updatePantryItem", "deletePantryItem"])

  # `onRecipeChanged` **is implemented** (W6 S11, D6 — pulled forward from a
  # planner-recommended W8, same per-field-authorizer pattern as
  # `onPantryChanged` above). Same "every push means refetch, no event-type
  # discriminator" constraint (E2E_MVP_PLAN.md §11.2.12) applies here too.
  onRecipeChanged(householdId: ID!): Recipe
    @aws_subscribe(mutations: ["createRecipe", "updateRecipe", "deleteRecipe", "favoriteRecipe", "setInRotation"])

  onMenuChanged(householdId: ID!): Menu
    @aws_subscribe(mutations: [
      "createMenu", "addMenuItem", "removeMenuItem",
      "autoFillWeek", "markMade"
    ])

  onShoppingListChanged(householdId: ID!): ShoppingList
    @aws_subscribe(mutations: [
      "generateShoppingList", "addShoppingListItem",
      "markPurchased", "haveIt"
    ])

  # `onHouseholdChanged` **is implemented** (W8 S10, E2E_MVP_PLAN.md
  # §14.2.10 D4/D5 — closes Phase 1's DoD line, previously shipped only as
  # `HouseholdSyncPolicy`'s poll). Same per-field-authorizer pattern as
  # `onPantryChanged`/`onRecipeChanged` above. The mutation list here is
  # NOT what this doc originally sketched: `leaveHousehold` was in the
  # original draft and is deliberately absent from what shipped —
  # `leaveHousehold`/`deleteHousehold` both return `Boolean!`, a structural
  # type mismatch against this field's `Household` shape, and even setting
  # that aside would need to hydrate a `Household` for a caller who has
  # just stopped being a member. A member leaving/a household being deleted
  # is an accepted staleness gap, closed on next route entry or foreground.
  onHouseholdChanged(householdId: ID!): Household
    @aws_subscribe(mutations: ["joinHousehold", "rotateInviteCode", "updateHouseholdSettings"])
}

# input types omitted for brevity — mirror the Type shapes, EXCEPT where
# `shared/schema.graphql` (the single source of truth once a slice actually
# ships) deliberately diverges: `RecipeInput`/`RecipeIngredientInput`/
# `RecipePatchInput` (W6 S2, E2E_MVP_PLAN.md §12.7 D3) omit every
# server-owned field (`id`, `householdId`, `sourceType`, `isFavorite`,
# `createdAt`/`updatedAt`) that a literal mirror of `Recipe`/
# `RecipeIngredient` would otherwise expose to the client.
```

### 6.2 Authorization

- **Layer 1 (AppSync):** `AMAZON_COGNITO_USER_POOLS` default; all queries/mutations require a valid Cognito JWT.
- **Layer 2 (Lambda resolvers):** every resolver receives the caller's `userId` in the identity context. First step of every resolver: verify `userId` is a member of the target `householdId`.
- **Layer 3 (Postgres RLS):** row-level security policies gate every table by `household_id`. Even if a resolver is buggy, the DB refuses to leak.
- **Subscription authorization:** custom Lambda authorizer on subscription connect validates the subscriber is a member of the requested `householdId`.

### 6.3 Resolver → data-source routing

| Resolver | Data source |
|---|---|
| Simple CRUD (pantry, recipes, menu, list) | Aurora Postgres via RDS Data API or direct connection |
| Auto-fill, generate shopping list, "cook from pantry" | Aurora + business logic in Lambda |
| Photo pantry, freeform parse, staples note | Bedrock via SDK |
| Upload URLs | S3 SDK |
| Export list image | Lambda uses `sharp` or similar to render, upload to `parimaan-exports`, return presigned URL |

**Aurora connection strategy:** use RDS Proxy in front of Aurora to pool connections (Lambda invocations otherwise open too many). Data API is an alternative but has higher per-call latency.

---

## 7. Data storage

### 7.1 Postgres schema (deployable DDL)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (mirror of Cognito identities)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);

-- Households
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  primary_user_id UUID NOT NULL REFERENCES users(id),
  subscription_status TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_status IN ('free','trial','active','past_due','cancelled')),
  plan_id TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_households_invite_code ON households(invite_code);

-- Household settings
CREATE TABLE household_settings (
  household_id UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  meals_enabled JSONB NOT NULL DEFAULT '["breakfast","lunch","dinner"]',
  meal_structure JSONB NOT NULL DEFAULT '{"lunch":{"carb":1,"sabzi_dal":2,"accompaniment":1},"dinner":{"carb":1,"sabzi_dal":2,"accompaniment":1}}',
  cuisine_tier1 JSONB NOT NULL DEFAULT '["north_indian"]',
  cuisine_tier2_weights JSONB NOT NULL DEFAULT '{}',
  dietary_tags JSONB NOT NULL DEFAULT '[]',
  allergens JSONB NOT NULL DEFAULT '[]',
  skip_ingredients JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memberships
CREATE TABLE household_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('primary','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(household_id, user_id)
);

CREATE INDEX idx_memberships_user ON household_memberships(user_id);
CREATE INDEX idx_memberships_household ON household_memberships(household_id);

-- Recipes
-- W6 S1 (E2E_MVP_PLAN.md §12.2.6/§12.2.8) deviates from this DDL as
-- originally drafted in three places, all additive: `updated_at` (below —
-- this block only had `created_at` before), a CHECK on `cuisine_tier1`
-- (§12.2.6 — an unrecognised value here would fail to serialize the
-- *entire* `Query.recipes` response, not just one field, since it's a
-- closed GraphQL enum), and RLS on `recipe_ingredients` (see the RLS block
-- below — this table was never in the original RLS list at all, despite
-- having no `household_id` of its own).
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('user','url','curated','ai','freeform_ai')),
  source_url TEXT,
  source_raw_text TEXT,
  title TEXT NOT NULL,
  description TEXT,
  servings INT NOT NULL DEFAULT 4,
  prep_min INT,
  cook_min INT,
  cuisine_tier1 TEXT CHECK (cuisine_tier1 IS NULL OR cuisine_tier1 IN ('north_indian','south_indian','pan_india','indo_chinese','continental')),
  cuisine_tier2 TEXT,
  dietary_tags JSONB NOT NULL DEFAULT '[]',
  role TEXT NOT NULL CHECK (role IN ('breakfast','carb','sabzi_dal','accompaniment','snack','sweet','drink')),
  in_rotation BOOLEAN NOT NULL DEFAULT TRUE,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  steps JSONB NOT NULL DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipes_household ON recipes(household_id);
CREATE INDEX idx_recipes_role ON recipes(household_id, role) WHERE in_rotation = TRUE;

CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT,
  category TEXT,
  notes TEXT,
  is_staple BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

-- Pantry
CREATE TABLE pantry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  category TEXT,
  is_staple BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_date DATE,
  low_threshold NUMERIC,
  added_by UUID NOT NULL REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pantry_household ON pantry_items(household_id);
CREATE INDEX idx_pantry_household_name ON pantry_items(household_id, LOWER(name));

-- Menus
CREATE TABLE menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  UNIQUE(household_id, week_start_date)
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_slot TEXT NOT NULL CHECK (meal_slot IN ('breakfast','lunch','snacks','dinner')),
  slot_role TEXT NOT NULL,
  servings_override INT,
  made_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_items_menu ON menu_items(menu_id);
CREATE INDEX idx_menu_items_recipe_recency ON menu_items(recipe_id, created_at DESC);

-- Shopping lists
CREATE TABLE shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  generated_from_menu_id UUID REFERENCES menus(id),
  ai_staples_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_shopping_lists_household_open ON shopping_lists(household_id)
  WHERE closed_at IS NULL;

CREATE TABLE shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT,
  category TEXT,
  source_recipe_id UUID REFERENCES recipes(id),
  purchased BOOLEAN NOT NULL DEFAULT FALSE,
  purchased_by UUID REFERENCES users(id),
  purchased_at TIMESTAMPTZ,
  moved_to_pantry BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_shopping_list_items_list ON shopping_list_items(shopping_list_id);

-- Notification prefs
CREATE TABLE notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  list_changes BOOLEAN NOT NULL DEFAULT TRUE,
  meal_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  expiry BOOLEAN NOT NULL DEFAULT TRUE,
  activity BOOLEAN NOT NULL DEFAULT TRUE,
  fcm_token TEXT,
  PRIMARY KEY (user_id, household_id)
);

-- Row-level security (enable per table)
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_settings ENABLE ROW LEVEL SECURITY;
-- Added W6 S1 (E2E_MVP_PLAN.md §12.2.2) — missing from this list originally,
-- a genuine gap: `recipe_ingredients` has no `household_id` of its own, and
-- is read via a `Recipe.ingredients` field resolver with no `householdId`
-- argument to gate on at the app layer, so RLS here is the SOLE
-- authorization, not defense-in-depth. Its policy is a parent-join, not a
-- membership subquery like every other table below — it composes with
-- `recipes`' own RLS-filtered visibility instead of duplicating the
-- membership rule:
--   CREATE POLICY recipe_ingredients_via_recipe ON recipe_ingredients
--     FOR ALL
--     USING (recipe_id IN (SELECT id FROM recipes))
--     WITH CHECK (recipe_id IN (SELECT id FROM recipes));
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
-- Added W8 S7 (E2E_MVP_PLAN.md §14.2.7) — also missing from this list
-- originally. `notification_preferences` is the only table below whose
-- policy is NOT membership-scoped: it is per-user. A fellow member of the
-- same household must not read or write another member's row — both
-- because preferences are personal and because the row carries
-- `fcm_token`, a device push credential whose leak lets another member's
-- device be targeted directly. `ENABLE` + `FORCE`, both `USING` and
-- `WITH CHECK` on `user_id` alone:
--   CREATE POLICY notification_preferences_own_row ON notification_preferences
--     FOR ALL
--     USING (user_id = current_setting('parimaan.user_id')::UUID)
--     WITH CHECK (user_id = current_setting('parimaan.user_id')::UUID);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Example RLS policy: pantry_items
CREATE POLICY pantry_household_member ON pantry_items
  USING (
    household_id IN (
      SELECT household_id FROM household_memberships
      WHERE user_id = current_setting('parimaan.user_id')::UUID
    )
  );

-- Similar policies for each table. Every policy actually shipped uses BOTH
-- `USING` and `WITH CHECK` (E2E_MVP_PLAN.md §11.2.2 — `USING` alone governs
-- SELECT/UPDATE/DELETE visibility but does nothing for INSERT) and `FORCE
-- ROW LEVEL SECURITY` (not just `ENABLE` — the table owner is otherwise
-- exempt), which this simplified example omits for brevity; see
-- `api/migrations/*.ts` for what's actually deployed.
-- Lambda sets 'parimaan.user_id' at connection start per request.
```

### 7.2 S3 bucket layout

```
parimaan-uploads-{env}/
  households/{householdId}/
    pantry-photos/{yyyy-mm-dd}/{uuid}.jpg   # user-uploaded pantry photos
    recipe-images/{recipeId}.jpg            # recipe cover images

parimaan-exports-{env}/
  households/{householdId}/
    shopping-lists/{listId}.png             # generated list image (30-day lifecycle)
```

- Buckets private by default; access via presigned URLs only (max 15 min expiry).
- SSE-S3 encryption at rest.
- CloudFront distribution in front of `parimaan-uploads` for recipe images (signed URLs); no CloudFront for pantry photos (short-lived, direct access).
- Lifecycle rule on `parimaan-exports`: expire objects after 30 days.

### 7.3 DynamoDB — single table for cache + rate limits

```
Table: parimaan-cache-{env}
  PK: string   # composite key by prefix
  SK: string
  ttl: number  # unix timestamp, auto-delete

Usage patterns:
  "aiCache#cookFromPantry#{householdId}#{pantryHash}" | "{}"      # 30-min TTL
  "aiCache#staplesNote#{listId}"                     | "{...}"    # 24-hr TTL
  "rateLimit#user#{userId}#{yyyy-mm-dd}"             | count      # 24-hr TTL
```

Single table, on-demand billing, sub-cent monthly.

### 7.4 Cognito user pool

- One user pool per environment.
- Google identity provider attached; no username/password path.
- Standard attributes: `email`, `name`, `picture`.
- Custom attributes: none for MVP.
- App clients: mobile (public, PKCE) + web (confidential).
- Post-confirmation Lambda trigger: upsert into `users` table.

---

## 8. AI services architecture

### 8.1 Model routing

| Task | Model | Why |
|---|---|---|
| Photo pantry (vision) | Claude Sonnet | Vision requires the larger model for accuracy |
| Cook-from-pantry (recipe suggestions) | Claude Sonnet | Complex reasoning over pantry + constraints |
| Freeform recipe parse | Claude Haiku | Structured extraction; Haiku is cheaper and fast enough |
| Staples note | Claude Haiku | Short summarization |

### 8.2 Invocation shape

> **Rewritten W7 S12** (`E2E_MVP_PLAN.md` §13.6, §18's D11 amendment below) to match what actually shipped for `parseFreeformRecipe`/the freeform-fallback path, rather than the pre-W7 Bedrock/Claude sketch this section originally carried (preserved directly below for whichever future week revisits Bedrock, since the shape — cache, rate limit, invoke, validate, one reinforcement retry, metric — is provider-agnostic and the original draft is still a reasonable starting sketch for that case).

The shape actually built, `api/src/ai/invokeModel.ts` (S2), consumed identically by every AI feature: no cache (none of W7's calls are cacheable — free-text input varies per call; caching is still a real future lever, W19 §13.2.13), a per-user daily rate limit checked and consumed exactly once before the first attempt (not per retry, §13.2.9 D8), Gemini invoked via a REST call authenticated with a Secrets-Manager-held API key (not IAM), the response validated against a Zod schema with an asymmetric strict-structure/lenient-enum split (D4, §13.2.5), and the full contract — one shared deadline, two independently-bounded retry chains, six client-facing error codes — locked in `E2E_MVP_PLAN.md` §13.2.7 and reproduced in §14 below rather than duplicated here.

```typescript
async function invokeModel<T>({
  prompt: string,
  outputSchema: z.ZodSchema<T>,
  deadline: number,       // shared wall-clock deadline, not a per-call timeout — §13.2.7/§13.2.8
}): Promise<T> {
  // 1. Fetch the Gemini API key from Secrets Manager (memoized per warm Lambda container)
  // 2. Call the Gemini endpoint; on 429/503/500/connection error, retry up to 2×
  //    with jittered backoff, deadline-gated → AI_BUSY if exhausted
  // 3. Parse the response as JSON; validate against outputSchema
  // 4. On JSON.parse failure or a Zod structural/bounds failure (never an
  //    enum-only failure — that degrades the one field with a warning instead):
  //    retry once with a "return valid JSON only" reinforcement → AI_UNPARSEABLE
  //    if the retry also fails
  // 5. Deadline exceeded at any point → AI_TIMEOUT
  // 6. Provider rejects the credential/model/quota outright → AI_UNAVAILABLE
  // 7. Return the validated, mapped result
}
```

The **original pre-W7 Bedrock/Claude sketch**, kept for a future Bedrock week rather than deleted (this codebase's own record-deviations-don't-silently-overwrite convention):

```typescript
async function invokeClaude<T>({
  model: 'sonnet' | 'haiku',
  systemPrompt: string,
  userMessage: string | MultimodalContent,
  outputSchema: z.ZodSchema<T>,
  cacheKey?: string,
  cacheTtl?: number,
}): Promise<T> {
  // 1. Check DynamoDB cache if cacheKey
  // 2. Check per-user rate limit
  // 3. Bedrock InvokeModel with anthropic_version
  // 4. Parse response, validate against outputSchema
  // 5. On parse failure: retry once with "return valid JSON only" reinforcement
  // 6. On second failure: throw AIError, client shows friendly message
  // 7. Write to cache if applicable
  // 8. Emit CloudWatch metric (model, tokens, latency, cost estimate)
}
```

### 8.3 Prompt management

- Prompts stored in `api/prompts/*.ts` — versioned, code-reviewed, unit-testable.
- Each prompt has a `PROMPT_VERSION` constant; logs include it for auditing.
- Prompts should never contain PII or household data at rest — they're templates with runtime injection.

### 8.4 Cross-region fallback

> **Annotated W7 S12:** not exercised in W7 — Gemini has no AWS-region model-access question at all (D11, §18), so `parseFreeformRecipe`/`importRecipeFromUrl` never hit this path. Left as-is below, unchanged, for whichever future week (W15/W17/W18/W19, still open per D11) actually revisits Bedrock, same treatment as §15 item 1.

If Bedrock `ap-south-1` doesn't have the required model at build time:

```typescript
const primary = 'ap-south-1';
const fallback = 'us-east-1';
try {
  return await bedrockClient(primary).invoke(...);
} catch (e) {
  if (isModelUnavailableError(e)) {
    return await bedrockClient(fallback).invoke(...);
  }
  throw e;
}
```

Cross-region adds ~150–250ms latency. Data egress is inside AWS (cheap). Only use if `ap-south-1` doesn't have the model — this is an infra check to do in the first week of month 5.

### 8.5 Cost + safety limits

- Per-user daily rate limit on each AI feature (DynamoDB counter): photo pantry 20/day, cook-from-pantry 10/day, freeform parse 20/day.
- Photo max size enforced client-side (1024px, JPEG q80) AND server-side (reject > 500KB).
- Every AI call emits a CloudWatch metric with an estimated cost (from token counts). Alarm if daily cost > $5.

### 8.6 Determinism + caching

- `temperature: 0.2` for structured outputs (recipe parse, photo pantry).
- `temperature: 0.6` for creative outputs (cook-from-pantry).
- Cache `cook-from-pantry` per (household, pantryHash) for 30 minutes.
- Cache `staplesNote` per shopping list forever (invalidate on list edit).
- Never cache photo pantry (unique inputs).

---

## 9. Frontend architecture

### 9.1 Flutter (mobile)

**Layers:**

```
lib/
  main.dart
  app/                    # app-wide setup, router, theme
  features/
    auth/
    household/
    pantry/
    recipes/
    plan/
    shopping/
    settings/
      each feature/
        presentation/     # screens, widgets
        state/            # Riverpod providers
        domain/           # use cases, models
        data/             # repositories, GraphQL calls
  shared/
    graphql/              # generated ferry client + operations
    ui/                   # design system: buttons, text, spacing
    storage/              # Drift DB, secure storage
    utils/
```

**State management:** Riverpod 2.x. One provider per feature slice. Selectors derive UI state. Family providers scoped to `householdId`.

**Local persistence:**
- `flutter_secure_storage` for Cognito tokens.
- `Drift` for structured read cache of pantry, recipes, current week's menu, current shopping list. **Confirmed, not deviated** (W5 S7 step 1 research, E2E_MVP_PLAN.md §11.3): `drift`/`drift_flutter`/`sqlite3_flutter_libs` are current and compatible with this app's `^3.13.0` SDK constraint; the cheaper alternative this step is required to evaluate — Ferry's own persisted (Hive) `Cache` store — is unmaintained (`hive`/`hive_flutter` last published 2021–2022, predates today's SDK) and was ruled out on that basis alone. `mobile/lib/shared/storage/` holds `app_database.dart`, `tables/pantry_items_table.dart`, `daos/pantry_dao.dart` — the DAO is the only thing that touches the DB; no Drift type leaks past it.
- **Read cache only** — mutations still go straight to network, no offline queue (below). Staleness policy is hydrate-then-fetch: `PantryController` emits the cached rows first (if any), then the network result overwrites wholesale — no field-level merge.
- **Eviction:** the pantry cache is cleared on sign-out (a cache surviving sign-out on a shared family phone is a privacy leak — the same concern that already keeps the in-memory Ferry cache from being persisted). Per-household eviction (`PantryDao.clearHousehold`) exists but has no caller yet — there is no household-switcher UI in the app today (`activeHouseholdProvider`'s own doc), so there is nothing to switch away from; every cache read is already `householdId`-scoped regardless, so this is a storage-hygiene gap, not a correctness one.
- On app start: hydrate UI from Drift, then fetch fresh via GraphQL.
- Mutations go straight to network (no offline queue in MVP).

**Real-time sync:** `ferry` itself ships no AppSync transport — AppSync's real-time protocol is not plain `graphql-ws` (see E2E_MVP_PLAN.md §11.3 S8 step 1's adopt-vs-hand-roll research). Hand-rolled in `shared/graphql/`: `appsync_realtime_protocol.dart` (pure frame-shape helpers), `subscription_client.dart` (`AppSyncSubscriptionClient` — the one multiplexed WebSocket connection for the whole app), and `appsync_websocket_link.dart` (the `gql_link` `Link`, chained after `AuthLink`, that routes `subscription` operations to it and forwards everything else to `HttpLink`). W5 (S8) shipped only `onPantryChanged`, with no reconnect logic — `onRecipeChanged` (W6 S11) followed the same shape. **Reconnect with backoff shipped in W8** (S3, §14.2.2/§14.3 S3 — see the decisions-log amendment below for the full design), and app-lifecycle wiring (disconnect on background, reconnect on foreground) in W8 S4: a subscriber stream now survives a transient disconnect on an established connection rather than closing immediately, retried via `ReconnectPolicy`'s ladder (**1s → 2s → 5s → 15s → 60s, ±20% jitter**), fetching a fresh token per attempt and resubscribing every still-registered subscription, with exactly one synthetic refetch signal emitted per subscription once its resubscribe is acknowledged — **not** a bulk local-cache invalidation, since the Ferry cache is never written into by subscriptions at all (§11.2.12's own "every push means refetch" convention). `onHouseholdChanged` (W8 S10) is the third and, as of Phase 2, final subscription field to ship.

**Image handling:**
- `image_picker` for camera / gallery.
- `image` package to downscale to 1024px longest edge.
- Upload via presigned URL with progress callback.

**Deep links:** `parimaan://join?code=ABC123` opens the join-household flow. Configured for iOS Universal Links and Android App Links.

### 9.2 Next.js (web)

- **App Router** with server components for public pages, client components for authenticated views.
- **Auth:** NextAuth.js with Cognito provider (OAuth code flow).
- **GraphQL:** `urql` with subscriptions via `graphql-ws`.
- **Deployed:** Amplify Hosting with automatic previews on PRs.
- **Scope:** view pantry / meal plan / shopping list; add + edit recipes (URL import + freeform paste); household settings admin. No meal-plan calendar editing on web MVP.

### 9.3 Shared TypeScript types

`shared/` package exports:
- GraphQL SDL (single source of truth).
- Generated TypeScript types for Lambda + web (via `graphql-codegen`).
- Zod schemas for AI outputs (used server-side for validation, client-side for optimistic types).

Flutter reads the same SDL and generates Dart via `ferry_generator`.

---

## 10. Auth & authorization deep dive

### 10.1 Authentication flow

- Cognito hosts the OAuth flow; app opens Cognito Hosted UI in a browser tab.
- Google is the only IdP; users tap "Continue with Google" and complete standard Google OAuth.
- On successful auth, Cognito returns: `id_token` (JWT, 1-hour), `access_token` (1-hour), `refresh_token` (30-day).
- Mobile stores tokens in `flutter_secure_storage`. Web uses NextAuth's httpOnly session cookie.

### 10.2 Session lifecycle

- ID token used for AppSync auth.
- Refresh happens transparently ~5 minutes before expiry.
- Logout: revoke refresh token, clear local storage, clear NextAuth session, disconnect WebSocket.

### 10.3 Authorization checks

Every mutation resolver runs this preamble:

```typescript
async function requireHouseholdMember(userId: string, householdId: string) {
  const membership = await db.query(
    'SELECT role FROM household_memberships WHERE user_id=$1 AND household_id=$2',
    [userId, householdId]
  );
  if (!membership) throw new ForbiddenError();
  return membership.role;
}
```

Membership cache: Lambda-level in-memory cache with 30s TTL avoids the DB round trip on every request from the same active user.

### 10.4 Subscription authorization

AppSync subscription connection uses a Lambda authorizer. On connect:

```typescript
async function onSubscribe({ userId, arguments: { householdId }}) {
  const isMember = await requireHouseholdMember(userId, householdId);
  return { isAuthorized: !!isMember };
}
```

Rejected connections close immediately; client shows "Session expired, please sign in again."

---

## 11. Observability

### 11.1 Logs

- All Lambdas write structured JSON to CloudWatch Logs.
- Fields: `timestamp`, `level`, `correlationId`, `userId`, `householdId`, `operation`, `latencyMs`, `errorClass`, `promptVersion` (for AI calls).
- Retention: 7 days on dev, 30 days on prod (configurable in CDK).
- Log Insights queries checked into `docs/queries/` for common debugging.

### 11.2 Metrics

CloudWatch custom metrics:
- `parimaan.lambda.<name>.duration`
- `parimaan.lambda.<name>.errors`
- `parimaan.ai.<feature>.calls`
- `parimaan.ai.<feature>.estimated_cost_usd`
- `parimaan.appsync.subscriptions.active`

### 11.3 Tracing

X-Ray enabled on Lambda + AppSync. Sampling: 100% dev, 10% prod. Bedrock calls traced as sub-segments to attribute latency.

### 11.4 Product analytics

PostHog SDK on Flutter + Next.js. Key events:
- `session_start`, `signed_in`, `household_created`, `household_joined`
- `recipe_created` (by source_type)
- `menu_item_added`, `auto_fill_used`
- `shopping_list_generated`, `have_it_used`, `list_shared`
- `ai_photo_pantry_used`, `ai_photo_pantry_confirmed_count`
- `ai_cook_from_pantry_used`, `ai_cook_from_pantry_saved_count`
- Funnel: install → sign_in → household_created → recipes_added → menu_created → list_generated

### 11.5 Alerts

CloudWatch Alarms → SNS → email:
- Lambda 5xx rate > 5% over 5 min
- AppSync 5xx rate > 5%
- Aurora CPU > 80% sustained 10 min
- Bedrock throttling errors > 10 over 5 min
- Daily AI cost > $5

---

## 12. Environments & deployment

### 12.1 Environments

| Env | AWS account | Domain | Data | Purpose |
|---|---|---|---|---|
| dev | Personal account | `dev.parimaan.app` | Synthetic + Amogh's household | Iterative development |
| prod | Separate account | `parimaan.app` | Real user data | Beta + eventual public |

No staging in MVP. Feature flags (PostHog) gate risky launches inside prod.

### 12.2 Repo layout (monorepo)

```
parimaan/
├── mobile/                 # Flutter app
│   ├── lib/
│   ├── ios/
│   ├── android/
│   └── pubspec.yaml
├── web/                    # Next.js
│   ├── app/
│   ├── components/
│   └── package.json
├── api/                    # Lambda resolvers
│   ├── src/
│   │   ├── resolvers/
│   │   ├── domain/
│   │   ├── prompts/
│   │   └── shared/
│   └── package.json
├── shared/                 # Cross-platform TS types + GraphQL SDL
│   ├── schema.graphql      # source of truth
│   ├── generated/
│   └── package.json
├── infra/                  # AWS CDK
│   ├── stacks/
│   │   ├── network-stack.ts
│   │   ├── auth-stack.ts
│   │   ├── data-stack.ts
│   │   ├── api-stack.ts
│   │   ├── frontend-stack.ts
│   │   └── observability-stack.ts
│   ├── bin/
│   └── package.json
├── recipes/                # Curated recipe seed JSON (month 4)
├── docs/                   # PRD, system design, etc.
├── package.json            # pnpm workspace root
└── pnpm-workspace.yaml
```

### 12.3 CDK stack structure

> **Amended 2026-08-14** (W1, during `NetworkStack` code review): the original text below listed RDS Proxy under `network-stack`, which both disagreed with §16's month-by-month plan (RDS Proxy lands in Month 2 as part of `api-stack`) and is now superseded by `E2E_MVP_PLAN.md` §10 Q1 (locked) — RDS Proxy is no longer a guaranteed component at all. Q1's decision is "direct Postgres connections first; add RDS Proxy only if the W3/W11 connection-load spikes show failures." RDS Proxy, if it ends up built, belongs conceptually next to the Aurora cluster it proxies (`data-stack`), not `network-stack` — a VPC/subnet/endpoint stack has no natural reason to own a database connection pooler. `network-stack` as actually implemented in W1 has 4 VPC endpoints (S3, DynamoDB — gateway; Bedrock, Secrets Manager — interface), not the "Bedrock + S3" pair originally written here.

- **network-stack:** VPC (2 AZs), subnets, VPC endpoints for S3, DynamoDB, Bedrock, and Secrets Manager.
- **auth-stack:** Cognito user pool, Google IdP config, app clients.
- **data-stack:** Aurora Serverless v2 cluster (auto-pause ON), S3 buckets, DynamoDB cache table, **RDS Proxy (conditional — only if the Q1 spike shows direct-connection failures; see `E2E_MVP_PLAN.md` §10 Q1)**. No customer-managed KMS key is created — Aurora and S3 use their AWS-managed default keys and DynamoDB its AWS-owned default, per §13.1's interpretation (amended below); the "KMS keys" bullet originally here is removed as it implied a resource this stack doesn't actually provision.

> **Amended** (`DataStack` build, W1/W2): the line above dropped its "KMS keys" bullet. §13.1's "Aurora: encrypted with account-managed KMS key" is interpreted as the AWS-managed default (`aws/rds`), not a customer-managed key the stack would create and pay for ($1/mo/key) — consistent with §13.1's own parallel wording for DynamoDB ("AWS-owned key") and the cost-discipline theme in `PRD.md` §17.4. Verified independently by two reviewers against actual synthesized CloudFormation (zero `AWS::KMS::Key` resources), not just source reading.
- **api-stack:** AppSync API, GraphQL schema, Lambda resolvers, Aurora connection (direct by default, or via RDS Proxy per the Q1 spike outcome), Bedrock IAM policy.
- **frontend-stack:** Amplify Hosting for web, CloudFront for CDN, Route 53 records.
- **observability-stack:** CloudWatch alarms, SNS topic, log retention config, X-Ray settings.

### 12.4 CI/CD (GitHub Actions)

Workflows:
- `.github/workflows/pr.yml` — on PR: lint, type-check, unit tests, Flutter analyze, Dart tests.
- `.github/workflows/deploy-dev.yml` — on merge to `main`: build + `cdk deploy` to dev + build web + build mobile with dev config.
- `.github/workflows/deploy-prod.yml` — on tag `v*.*.*`: manual approval gate → `cdk deploy` to prod + Amplify prod deploy + submit Flutter builds to TestFlight and Play Console.
- `.github/workflows/db-migrate.yml` — runs `node-pg-migrate up` against target env; gated on approval for prod.

### 12.5 Secrets

- `google-oauth-client-secret` → Secrets Manager
- `aurora-master-password` → managed by RDS (rotation on)
- All other config (API URLs, feature flags, log levels) → SSM Parameter Store standard tier (free)

---

## 13. Security model

### 13.1 Data at rest

- Aurora: encrypted with account-managed KMS key. Backup encryption ON. 7-day PITR.
- S3: SSE-S3 default; consider SSE-KMS for `parimaan-uploads` if pantry photos are deemed sensitive.
- DynamoDB: encryption at rest ON (AWS-owned key).
- Secrets Manager: encrypted with account-managed KMS key.

### 13.2 Data in transit

- TLS 1.2+ enforced everywhere.
- ACM-managed certificates for all custom domains.
- Certificate pinning on mobile: NOT in MVP (adds ops burden).

### 13.3 Least privilege IAM

- One IAM role per Lambda function.
- Bedrock `InvokeModel` limited to specific model ARNs.
- S3 access via presigned URLs; bucket policies deny public access.
- RDS Proxy IAM authentication (no password in Lambda env).
- Every CDK-generated policy reviewed manually for least privilege.

### 13.4 Input validation

- GraphQL SDL enforces type + shape at API edge.
- Zod schemas re-validate all mutation inputs inside Lambda.
- Prompt inputs escaped/bounded (max 4000 chars for freeform recipe text).
- SQL: parameterized queries only (via `pg` node client, never string concat).

### 13.5 Rate limiting

- AppSync built-in throttling: 100 req/sec/user (adjustable).
- Per-user daily AI limits: enforced in Lambda via DynamoDB counter.
- Per-household daily AI limits (soft): warn at 80% of daily cap, block at 100%.

### 13.6 PII

- PII stored: email (Cognito + `users` mirror), display name, avatar URL, pantry photos.
- No credit card data in MVP (no payments).
- All data in `ap-south-1` for India data residency.
- Delete-account flow (v1.1): cascades DELETE across all household data where user is sole primary; membership rows removed otherwise.

### 13.7 Content moderation

- Bedrock has built-in refusals for harmful content. No additional moderation in MVP.
- User-uploaded photos not moderated in MVP (household-private, low risk).

---

## 14. Failure modes & fallbacks

> **The four AI rows this table originally carried (Bedrock throttled / model-unavailable / unparseable-JSON, plus a placeholder URL-import row) are replaced below by the real, shipped error-code contract** — `E2E_MVP_PLAN.md` §13.2.7 (D7, W7 S2), consumed by `graphql_error_mapper.dart` on the **code**, never on message text (asserted by a named mobile test, W7 S9/S11). The original three-Bedrock-row sketch predates D11's Gemini deviation (§18) and named no codes at all — not something a mobile error mapper could branch on.

| Code | Cause | User experience | Retryable by user? | Mobile destination |
|---|---|---|---|---|
| `AI_BUSY` | Gemini transport chain exhausted (429/503/500/connection error, up to 2 retries) | "Recipe import isn't available right now" / differentiated copy | **Yes** | Inline retry on the input screen — pasted text is never lost |
| `AI_TIMEOUT` | shared 15s deadline (§13.2.7) hit with no usable response | differentiated copy | **Yes** | Inline retry |
| `AI_UNPARSEABLE` | Gemini output chain exhausted (JSON.parse or structural/bounds Zod failure, plus one reinforcement retry) | "Couldn't understand that recipe" | No | AI failure fallback screen (`ai_failure_screen.dart`, W7 S11) — pasted text preserved, "enter manually" / "paste again" both offered |
| `AI_UNAVAILABLE` | provider rejected the credential/model/quota outright | "Recipe import isn't available right now" | No | AI failure fallback screen |
| `URL_UNREADABLE` | SSRF-rejected URL, transport failure, or no usable `Recipe` JSON-LD on the page (S5) — all three surface identically, never distinguished (§13.2.10's "never an oracle" contract) | "Couldn't read that page" | No | AI failure fallback screen, with the redundant "paste text instead" button hidden (this failure *is* the paste-instead outcome already) |
| `RATE_LIMITED` | the caller's own daily cap for that action (§13.2.9 D8) | distinct copy naming the specific action's cap (e.g. "you've reached today's limit of 20 recipe parses") — **a real bug found and fixed in W7 S12** (`RUNBOOK.md` §2): a shared bare-constructor default previously leaked `joinHousehold`'s own copy onto every other capped action | No | Inline, never the fallback screen |
| `VALIDATION` | input rejected before any provider call (empty, or >4,000 chars) | inline field error | n/a — no call was ever made | Inline on the input field |

Non-AI failure modes, unchanged from the original draft:

| Failure | User experience | Recovery |
|---|---|---|
| Aurora down | AppSync returns 503 | Mobile shows last-known cache; retry banner |
| AppSync down | GraphQL calls fail | Mobile shows offline state, cache-only |
| S3 upload fails | Retry with backoff (client-side) | On 3rd fail, save locally, retry next foreground |
| WebSocket dropped | Mobile shows "reconnecting" indicator | Backoff reconnect + full refetch on reconnect |
| Cognito down | New logins blocked | Existing sessions continue until token expiry |
| FCM delivery fails | Notification silently lost | Non-blocking; next opening of app catches state |

---

## 15. Design assumptions to verify early

Ranked by risk × impact:

1. **Bedrock model availability in `ap-south-1`.** Check `us-east-1` fallback path works. → Week 1, month 5. **Not exercised in W7 (D11, `E2E_MVP_PLAN.md` §13.2.2)** — W7's AI runs on Gemini instead, a scoped deviation; still open for any future Bedrock week. A real check run during W7 S2 anyway (not this assumption's own W7 obligation, just incidental information gathered while re-evaluating the provider choice) found Claude Haiku 4.5 genuinely listed as available in `ap-south-1`, but invocation blocked on "Model use case details have not been submitted for this account" — a real console form step with no guaranteed turnaround, inherited by whichever week actually revisits Bedrock.
2. **Aurora Serverless v2 auto-pause behavior in `ap-south-1`.** Verify pause + resume latency is acceptable (usually 15–30s cold). → Month 1.
3. **AppSync GraphQL subscription throughput** with 5 concurrent household members editing at once. → Month 3 integration test.
4. ~~**JSON-LD `Recipe` schema coverage** on top-20 Indian recipe blogs. → Week 1, month 2.~~ **Resolved, W7 S1/S12.** 15/20 ld+json present, 14/20 usable draft (`E2E_MVP_PLAN.md` §13.5.12) — D10's 10–15/20 middle tier fired: URL import shipped, copy-paste given equal visual prominence. Re-confirmed live through the deployed mutation in S12 (§13.5.13): 14/20 (70.0%), matching the spike exactly, after fixing a real regression (§8.4/§14's `fetchPage.ts` byte-cap note above).
5. **RDS Proxy behavior** under Lambda concurrency spikes. → Month 3.

---

## 16. What lands in month-by-month CDK work

| Month | CDK stacks that must exist |
|---|---|
| 1 | network-stack (VPC), auth-stack, data-stack (Aurora + S3 uploads + DynamoDB), api-stack (AppSync + hello-world resolver) |
| 2 | api-stack: pantry + recipes resolvers, RDS Proxy wired |
| 3 | api-stack: menu + shopping-list resolvers, subscription auth Lambda |
| 4 | frontend-stack (Amplify Hosting for web), curated recipes seeded via one-off Lambda |
| 5 | api-stack: Bedrock IAM, AI resolvers, DynamoDB rate-limit table, FCM Lambda for push |
| 6 | observability-stack (alarms, dashboards), CI/CD prod workflow, TestFlight + Play Console config |

---

## 17. Open questions

Design-level, ranked by decision urgency:

1. **RDS Proxy vs. Data API vs. direct connection?** RDS Proxy is best-in-class for Lambda-to-Aurora but adds ~$18/mo baseline cost. Data API scales to zero but has higher per-call latency. Direct connections risk exhaustion under Lambda concurrency. Lean: **RDS Proxy** — the reliability outweighs the cost. Revisit if beta cost matters more than we thought.
2. **Amplify libraries client-side vs. hand-rolled Cognito + AppSync clients?** Amplify JS/Flutter libraries bundle auth + API + storage — faster to build, heavier, opinionated. Lean: **hand-rolled** for control and smaller bundle size.
3. **List image generation — where?** Options: Lambda (`sharp` or Puppeteer), Bedrock (Claude renders SVG we convert to PNG?), client-side (Flutter renders and uploads). Lean: **client-side Flutter render** — no Lambda cost, no cold-start latency, WYSIWYG.
4. **How to seed the curated library into every new household?** Copy rows on household creation (fast, storage cost per household) vs. shared `curated_recipes` table with an `is_curated` flag in queries (denser, more query complexity). Lean: **copy on creation** — simpler queries, small data.
5. **DB migrations against Aurora Serverless v2 with auto-pause.** Migrations trigger cold resume; CI job needs to handle that. Solve via a "warm-up" Lambda invoked before migration.
6. **PostHog events — India cloud or US?** PostHog EU has an India presence via `eu.i.posthog.com`. Verify data residency wording before signing up.

---

## 18. Decisions log

> **Amended 2026-08-14** (W1, during `auth-stack` planning): two lines below were superseded by decisions locked later in `E2E_MVP_PLAN.md` §10 and never reconciled back here — same class of drift already fixed once in §12.3. Both corrected below; original wording struck through for the audit trail.
> - Auth: ~~hand-rolled clients, not Amplify libraries~~ → **Q2 (locked):** `amplify_auth_cognito` used for OAuth only (PKCE/redirect/refresh handling — realistically a 1-2 week hand-roll cost otherwise); everything else (GraphQL client, state) stays hand-rolled.
> - DB: ~~accessed via RDS Proxy~~ → **Q1 (locked):** direct Postgres connections first; RDS Proxy added only if the W3/W11 connection-load spikes show failures, not a guaranteed component.

> **Amended 2026-08-26** (W5 S8, during `onPantryChanged` subscription implementation): §10.4 said subscription authorization is "a Lambda authorizer on subscription connect" — an API-level `AWS_LAMBDA` auth mode. **Deviation (E2E_MVP_PLAN.md §11.2.9, locked as §11.7 Q4):** a Lambda **resolver** on the `Subscription.onPantryChanged` field instead, invoked once at subscribe time, reusing `requireHouseholdMember` unchanged. Same security property — a non-member is denied before the connection is ever accepted — for far less machinery: no second API auth mode, no per-request invocation on unrelated fields, Cognito stays the API's sole `AuthenticationType`. Chosen after an explicit complexity/response-time/cost comparison against the API-level authorizer. Applies to every future subscription field the same way; §10.4's original wording is superseded, not just for `onPantryChanged`.

> **Amended 2026-08-26** (W5 S7, during the Drift local read-cache implementation): §9.1's `Drift` choice is **confirmed, not deviated** — the step-1 research this slice's own plan entry requires (E2E_MVP_PLAN.md §11.3 S7) evaluated `drift`/`drift_flutter`/`sqlite3_flutter_libs` against this app's `^3.13.0` SDK constraint (all current/compatible) and against the cheaper alternative Ferry's `Cache` hook already supports — a persisted Hive store — which turned out to be unmaintained (`hive`/`hive_flutter` last published 2021–2022, predates the app's SDK floor) and was ruled out on that basis alone. §9.1 above is updated in place with the confirmed dependency set, cache scope (read-only, no offline queue), staleness policy (hydrate-then-fetch, wholesale overwrite, no merge), and eviction triggers (sign-out, household switch).

> **Amended 2026-08-27** (W6 S1/S2, during the recipes migration and SDL): four deviations from this doc's original `recipes`/`recipe_ingredients` design, all locked in `E2E_MVP_PLAN.md` §12.7 (D3, D4): (1) `recipes.updated_at` added — §7.1's DDL had only `created_at`; (2) a `CHECK` on `cuisine_tier1` added as a DB-level backstop (§12.2.6) — unlike `pantry_items`' free-text `unit`/`category` (§11.2.4), `role`/`cuisineTier1`/`dietaryTags` are closed GraphQL enums, and an unrecognised persisted value fails to serialize the *entire* `Query.recipes` response, not just one field — enforced server-side by rejecting (not canonicalising-and-passing-through) at `api/src/domain/{recipeRoles,cuisineTiers,dietaryTags}.ts`; (3) RLS enabled on `recipe_ingredients` (§12.2.2) — never in §7.1's original RLS list at all, despite the table having no `household_id` of its own and being read via a field resolver with no `householdId` argument to gate on at the app layer, making RLS the sole authorization there; (4) `updateRecipe` takes `RecipePatchInput!` (not `RecipeInput!`) and `deleteRecipe` returns `Recipe!` (not `Boolean!`) — matching the `PantryItemPatchInput`/`deletePantryItem` precedents already locked in W5 (§11.7 Q1–Q2). §6.1/§7.1 above are updated in place; a real bug found in (2)'s first attempt — the migration's own `CHECK` briefly disagreed with the already-shipped `CuisineTier1` enum values (`household_settings.cuisine_tier1`) — was fixed by a follow-up migration (`1787811731724_fix-recipes-cuisine-tier1-check.ts`) rather than editing the already-applied one.

> **Amended 2026-08-28** (W7 S2, during the AI invocation layer): this doc and the PRD assume Bedrock everywhere for AI features (this decisions log's own "AI: Bedrock Claude..." line below, §6 R1, §8.2/§8.4's `InvokeModel` sketch, §15 item 1 above). **W7 deviates, deliberately and scoped to W7 only (`E2E_MVP_PLAN.md` §13.2.2, D11):** `parseFreeformRecipe` and the freeform-fallback path off a failed URL import both call **Gemini 3.5 Flash-Lite**, not Bedrock/Claude. Real-call testing during S2 found the plan's originally-assumed model, "Gemini 2.5 Flash," already deprecated for new callers; two further real rounds (`gemini-3.6-flash` — works, but rejects fully disabling its internal "thinking" and measured p95 ≈ 8.7s even at the lowest accepted setting; `gemini-3.5-flash-lite` — 10/10 real calls, zero thinking overhead, p95 ≈ 4.2s, and pricing restored to the originally-assumed $0.30/M input, $2.50/M output) landed on the model actually shipped. Auth is a Secrets-Manager-held API key (`parimaan/gemini-api-key`), not AWS IAM; the AI/URL Lambdas are non-VPC (no route to Aurora, `householdId` dropped from both mutations' signatures rather than accepting an argument that can't be authorized); the existing idle `BEDROCK_RUNTIME` VPC interface endpoint (`infra/stacks/network-stack.ts`) is deliberately left untouched, available to whichever future week revisits Bedrock. **The provider choice for W15 (staples note), W17 (vision), W18 (photo pantry), and W19 (cook-from-pantry) remains fully open** — this amendment covers W7's two mutations only, not a codebase-wide switch off Bedrock.

> **Amended 2026-08-28** (W7 S3, during the `parseFreeformRecipe` mutation): §6.1 above previously showed `parseFreeformRecipe(householdId: ID!, text: String!): Recipe!`, per this doc's own original draft — shipped as `parseFreeformRecipe(text: String!): RecipeDraft!` instead (`E2E_MVP_PLAN.md` §13.2.3 D1, §13.2.1 D3, both locked ahead of this slice and now confirmed as-built). Two deviations from the original draft, both already reflected in §6.1 above rather than left to drift: (1) a new `RecipeDraft`/`RecipeIngredientDraft` output type, not `Recipe!` — a `Recipe` has ten non-null fields (id, householdId, timestamps, ...) an unsaved proposal has no honest value for, and returning it would hand every client cache/mapper something indistinguishable from a persisted row; (2) `householdId` dropped from the signature entirely, not merely unused — this resolver runs on the non-VPC Lambda category S2 built (D3: the VPC's `natGateways: 0` means an internet-reaching Lambda has no route out from inside it), so it cannot run `requireHouseholdMember`, and accepting an argument it cannot authorize would violate this codebase's own existence-oracle convention (§12.2.5's precedent). The caller is still a verified Cognito principal; the actual abuse control is a 20/day-per-user DynamoDB rate limit keyed on the Cognito `sub` directly (`'freeformParse'`, §13.2.9 D8), asserted by a named test rather than merely being true. D4 (§13.2.5) is the validation-boundary decision this slice implements: the Zod schema validating Gemini's JSON response is strict on structure/bounds (fails the whole parse, triggering `invokeModel`'s one reinforcement retry) but asymmetrically lenient on the three closed-enum fields (`cuisineTier1`/`role`/`dietaryTags`) — an unrecognised value there degrades to `null` with a warning recorded in `RecipeDraft.warnings`, never failing an otherwise-good parse over one field. D5 (§13.2.6) is why `RecipeDraft.role` stays nullable even though `RecipeInput.role` is required with no default (W6 D1): an AI-proposed role is a proposal, not a default — W6 D1 still holds in full, enforced at confirm time (S10), not here.

> **Amended 2026-08-28** (W7 S5, during the `importRecipeFromUrl` mutation): same D1/D3 deviation as `parseFreeformRecipe`'s own amendment immediately above (`RecipeDraft!`, not `Recipe!`; no `householdId`) — already reflected in §6.1. The new decision this slice adds is the SSRF control set itself (§13.2.10), implemented as two deliberately separate modules (`api/src/net/safeUrl.ts`, `api/src/net/fetchPage.ts`) rather than inline in the resolver, since it is a security control with its own test suite and a later feature may reuse it: `https`-only scheme allowlist; credentials/non-default-port/IP-literal-host rejection; explicit DNS resolution checking EVERY resolved address (not just the first) against private/loopback/link-local/CGNAT/reserved ranges for both IPv4 and IPv6 — the IPv6 check specifically covers Teredo (2001:0000::/32), 6to4 (2002::/16), and NAT64 (64:ff9b::/96) tunnelling prefixes and the deprecated IPv4-compatible form (`::a.b.c.d`), found missing from an initial string-prefix-based implementation during this slice's own security review (a real public address sharing a textual prefix with a reserved range, e.g. `2001:4860::1` vs. the Teredo prefix `2001:0000::/32`, could otherwise be misjudged either way — fixed by expanding any textual IPv6 form to its 8 numeric groups before range-checking, rather than matching on the string); at most 3 redirects with the full gate re-run on every hop (closing the "public URL redirects to a private/metadata address" attack, the single most important control here); the outbound connection pinned to the DNS-validated address (closing the DNS-rebinding window between validation and connect) while TLS SNI/the `Host` header carry the original hostname; an 8-second **total** budget across every hop enforced by an explicit deadline timer — NOT Node's `https.request` `timeout` option, which is a socket *idle* timer a slow-drip server can reset indefinitely rather than a real wall-clock deadline, also found and fixed during this slice's review; a response cap aborted mid-stream (1MB at ship time; **raised to 5MB in W7 S12** — see the amendment below — after a real S1-validated site, `indianhealthyrecipes.com`, grew past 1MB between S1's spike capture and S12's live-deployment re-verification, silently excluding an otherwise-usable import); an HTML-only `Content-Type` check; and a descriptive, non-spoofed `User-Agent` (§13.2.14: `Parimaan/1.0 (+https://parimaan.app)`, no `robots.txt` fetch for a single user-initiated import, no retry on 4xx/429). A fetch failure and a "no usable `Recipe` JSON-LD on the page" parse failure both surface as the identical `URL_UNREADABLE` client error, matching SD §14's "couldn't read this page" fallback — never distinguished, since revealing *why* a URL was rejected would itself be an internal-network reconnaissance oracle. Rate-limited at 30/day per user (`'urlImport'`, §13.2.9 D8), checked before any DNS lookup. This Lambda has no Gemini secret access at all, unlike `parseFreeformRecipe` — asserted by a dedicated negative CDK test, not merely true by omission.

> **Amended 2026-08-28** (W7 S6, during `createRecipe`'s confirm path): §6.1 above previously showed `createRecipe(householdId: ID!, input: RecipeInput!): Recipe!` with `sourceType` hardcoded to `user` (§12.2.3 D3, W6) and no way to write `sourceUrl` — the gap §13.2.4 D2 identified: neither `parseFreeformRecipe` (S3) nor `importRecipeFromUrl` (S5) had anywhere to write their draft's provenance once confirmed. Shipped exactly as D2 locked it, option (a) over the alternative server-side-draft-token design (b): a new optional `source: RecipeSourceAttribution` argument, `{sourceType: RecipeSource!, sourceUrl: String}`. Absent (every pre-W7 caller, unchanged) resolves to `sourceType: 'user'`, `sourceUrl: null` — every W6 `createRecipe` test still passes with its assertions unmodified, the strongest evidence the argument is genuinely optional. When present, `sourceType` is restricted server-side (Zod, not the GraphQL enum — `RecipeSourceAttribution.sourceType` is typed against the full `RecipeSource` enum for schema simplicity, per its own doc comment) to `url`/`freeform_ai` only: `curated` (the W13/W14 curated seeder) and `ai` (a future cook-from-pantry feature) are server-owned values a client can never claim through this argument, verified end-to-end by a named test rather than left implicit. `sourceUrl` is required exactly when `sourceType: 'url'` (rejected for every other value, including absent `source`) and must be a valid `https` URL — it is stored, untrusted, third-party-influenced text displayed to other household members later, the same trust boundary `importRecipeFromUrl`'s own `url` argument sits on. `source_url` was already an existing nullable column (added in the W6 `1787808112003_recipes` migration, never previously written) — this slice needed no new migration, only wiring it into `insertRecipe`'s column list.

> **Amended 2026-08-31** (W7 S12, during the week's real-AWS verification pass): two real bugs found by actually exercising the deployed stack, neither caught by any of the week's 940+ unit/integration tests — full detail in `RUNBOOK.md` §2, referenced here for the decisions-log record. (1) `checkAndIncrementDailyAction`'s shared `RateLimitedError` construction had no message parameter and silently inherited a class-default written for `joinHousehold`'s own copy, leaking that copy onto `parseFreeformRecipe`/`importRecipeFromUrl`/`rotateInviteCode`'s unrelated caps — found live when S12's own 20-call acceptance-measurement batch hit `parseFreeformRecipe`'s cap on its 20th call. Fixed by making the message a required parameter, threaded per call site. (2) `fetchPage.ts`'s `DEFAULT_MAX_BYTES` (1MB at ship time) silently excluded `indianhealthyrecipes.com` — one of S1's own 14/20 originally-usable sites — once that site's real page grew past 1MB between S1's 2026-08-28 capture and S12's 2026-08-31 re-verification; raised to 5MB (§8.4/§14/§6.1's SDL comment above), re-verified live: 14/20 (70.0%), matching S1's original number exactly. Both fixes deployed to `Parimaan-dev-Api` and re-verified via direct Lambda invoke before this amendment was written, not merely unit-tested. **Also this pass:** the DoD gate's acceptance measurement itself — 19/20 (95.0%) freeform parses accepted against PRD §11's ≥80% bar — plus a real SSRF attempt against the deployed `importRecipeFromUrl` endpoint (5 vectors: AWS metadata IP, loopback, RFC1918 private, plain `http://`, non-default port — all 5 rejected identically). Full writeup: `E2E_MVP_PLAN.md` §13.5.13.

> **Amended 2026-09-01** (W8 S3, during reconnect-with-backoff): `mobile/lib/shared/graphql/subscription_client.dart`'s W5-era contract — a channel-level error/done closes every active subscriber immediately — is **inverted** for an established connection (`E2E_MVP_PLAN.md` §14.2.2/§14.3 S3, locked in §14.7 D11): once `connection_ack` has landed, a dying transport no longer closes subscriber streams at all; they survive while a `ReconnectPolicy` ladder (1s→2s→5s→15s→60s, ±20% jitter, resets on success — a plain value object with no `Timer`/socket dependency, `mobile/lib/shared/graphql/reconnect_policy.dart`) retries. A subscription's own **first-ever** connect failure is unaffected — closed exactly as before, via `subscribe()`'s own `onListen` catch, never reaching this changed path at all. Three further decisions locked during implementation, not pre-specified in §14.3's own RED-test list: (1) `connection_error` is now mapped to `UnauthorizedError` everywhere (previously a generic `InternalError`) — this client's `connection_init` carries nothing but the AppSync auth header, so a server-side rejection of it realistically means a bad/expired credential, and this is what lets the reconnect ladder recognise a `connection_error` against a freshly-fetched retry token as terminal without any message-string matching; (2) every reconnect attempt fetches a fresh token via an injected `IdTokenProvider` (never the token cached from the original `subscribe()` call), and a null/empty token or a `connection_error` against a fresh one is treated as unrecoverable — every subscriber closes with `UnauthorizedError` and the ladder stops, rather than retrying forever against a credential that will never become valid on its own; (3) on each successful reconnect, every still-registered subscription is resubscribed (same id, its own originally-registered query/variables) and emits exactly one synthetic refetch signal once its resubscribe's own `start_ack` lands (§14.2.4 — a push during the gap is otherwise silently lost) — gated on a separate `_pendingRefetchAcks` set so a subscription's genuine first-ever `start_ack` never fires one. A security-review finding from this slice: the reconnect connect URI embeds the id token (reversibly base64'd, not encrypted) in its own query string, and a real platform `WebSocketException` commonly echoes the failed URI verbatim in its message — a first-connect transport error is now explicitly sanitized to a generic `InternalError` before reaching the caller, rather than propagating the raw platform exception, closing that leak path ahead of any future error-reporting/telemetry integration. `connectionState` (a plain `ValueNotifier<ConnectionState>`, not a Riverpod provider) is exposed with no UI consumer in W8 — deliberate (§14.7 D10) — deferred to whichever later week adds the offline-banner.

> **Amended 2026-09-01** (W8 S4, during app-lifecycle wiring): a new `mobile/lib/app/subscription_lifecycle_observer.dart` wraps the app root (alongside the existing `JoinDeepLinkListener`) and drives `AppSyncSubscriptionClient`'s two public entry points off real `AppLifecycleState` transitions (`E2E_MVP_PLAN.md` §14.3 S4) — `paused`/`detached` call `disconnect()`, `resumed` calls a new `reconnectNow()` (bypasses the backoff ladder's wait and resets `ReconnectPolicy` to its first rung), `inactive`/`hidden` are deliberately ignored as momentary, not-really-backgrounded interruptions. `reconnectNow()` no-ops when there are no registered subscriptions or a connection is already established/in-flight. `mobile/lib/shared/graphql/client.dart`'s `ferryClientOverride()` now returns `List<Override>` (was a single `Override`) so a new `subscriptionClientProvider` can expose the *same* `AppSyncSubscriptionClient` instance the Ferry `Client` is built over, letting the observer reach it without a route back down through the GraphQL client. Three real races found and fixed during this slice's own flutter-review pass, all reachable by the lifecycle wiring this slice introduces, not pre-existing: (1) `disconnect()`/`reconnectNow()` are now serialized against each other (`_lifecycleOperationQueue`, a simple `Future`-chaining queue) — without it, a `reconnectNow()` arriving while an immediately-preceding `disconnect()` was still mid-close would read stale connection state and silently no-op, permanently swallowing the foreground signal; (2) `disconnect()` now fails any pending `connection_ack` completer with a new private `_ConnectAbortedByDisconnect` sentinel before tearing down — previously it could abandon an in-flight connect attempt's completer uncompleted, hanging whichever caller (a fresh `subscribe()`, or the ladder's own `_attemptReconnect()`) was awaiting it forever; the ladder's own catch treats this sentinel as "do not reschedule" (the ladder must not run while deliberately disconnected) while `subscribe()`'s own catch maps it to a public `InternalError`; (3) `disconnect()` fails that same pending completer *immediately*, ahead of its own queue position, so a `disconnect()` arriving while a queued `reconnectNow()`'s handshake is still pending tears the transport down right away rather than waiting behind it for up to the full connect timeout. `reconnectNow()`'s own no-op guard was also widened from checking only `_isConnected` to `_connectionAck != null` (a strict superset covering "connecting" too), closing a duplicate-`start`-frame race against the ladder's own independently-triggered reconnect attempts.

> **Amended 2026-09-01** (W8 S5, during the membership TTL cache): §10.3's own sketch above ("Membership cache: Lambda-level in-memory cache with 30s TTL avoids the DB round trip on every request from the same active user") is now **implemented as specified**, confirmed rather than deviated — `api/src/cache/ttlCache.ts` (a small, dependency-free, generic `TtlCache<K,V>`, the same module-scope-memoization shape `db/pool.ts`'s pooled connection and `ai/geminiClient.ts`'s memoized key already use, extended to hold many keyed entries) sits in front of `requireHouseholdMember` (`api/src/auth/requireHouseholdMember.ts`), keyed on `` `${userId}:${householdId}` `` (collision-safe because both are always UUIDs). Reviewed and locked as an **authorization-weakening change**, not a performance change (`E2E_MVP_PLAN.md` §14.2.8, D2 — CRITICAL, the week's highest-severity item), with a four-part contract verified by a dedicated security-review pass, all four PASS: (1) only positive results are ever cached — a denial is never written to the cache, so a member who has just joined is never locked out for 30s; (2) the four membership-mutating/destructive resolvers (`joinHousehold`, `leaveHousehold`, `deleteHousehold`, `rotateInviteCode`) always read live — `deleteHousehold`/`rotateInviteCode` (the two that actually call `requireHouseholdMember`) pass a new `{ bypassCache: true }` option; `joinHousehold`/`leaveHousehold` have no gate to bypass at all (by design, unrelated to this cache); (3) all four call a new `evictMembershipCache(userId, householdId)` after their own successful mutation — best-effort, this Lambda execution environment's own cache only, never reaching other warm containers; (4) the accepted ≤30s stale-authorization window is documented in `requireHouseholdMember.ts`'s own doc comment together with why it's safe: every RLS-protected table (`pantry_items`, `recipes`, `recipe_ingredients`, `household_settings`) still gets a live RLS check regardless of a stale layer-2 pass, so the genuine exposure is narrowed to the tables with no RLS of their own (`households`, `household_memberships`), which is the class of query this gate is the *sole* protection for.

> **Amended 2026-09-01** (W8 S10, during `onHouseholdChanged` + poll retirement): closes Phase 1's own DoD line ("Household settings persist and sync across devices via `onHouseholdChanged` subscription"), previously shipped only as `mobile/lib/features/household/state/household_sync_policy.dart`'s 15-second poll (`E2E_MVP_PLAN.md` §14.2.10, D4/D5). `Mutation.updateHouseholdSettings` widened its return type from `HouseholdSettings!` to `Household!` (a locked-SDL change, D4) so it can attach to the new `Subscription.onHouseholdChanged(householdId: ID!): Household`, `@aws_subscribe`d to `joinHousehold`/`rotateInviteCode`/`updateHouseholdSettings` — same subscribe-time Lambda-resolver authorization shape as `onPantryChanged`/`onRecipeChanged` (identical `requireHouseholdMember` gate, reading through the W8 S5 membership cache like every other subscribe-time authorizer). **`leaveHousehold`/`deleteHousehold` are deliberately NOT attached**, a real deviation from this doc's own original §6.1 sketch (which listed `leaveHousehold` on the mutation list) — both return `Boolean!`, a structural type mismatch against a `Household`-shaped subscription (AppSync requires an `@aws_subscribe`d mutation's return type to match the subscription field's) regardless of authorization, and even setting that aside, either would need to hydrate a `Household` for a caller who has just stopped being a member — the same thing `requireHouseholdMember` would deny them at that point. A member leaving/a household being deleted stays an accepted staleness gap, closed on next route entry or foreground rather than by a push. On the mobile side, `HouseholdSyncPolicy`'s poll cadence and idle-decay machinery (`pollInterval`, `idleTimeout`, `markActive()`, `isPolling`, the `Timer.periodic`) were deleted outright rather than left dormant — what remains is refetch-on-route-entry and refetch-on-foreground only, the two triggers a live push cannot itself provide (a screen that wasn't mounted to receive a push, and the socket disconnecting while backgrounded per W8 S4). Reviewed by a dedicated security-review pass (fired per the plan — new Lambda resolver, subscription authorizer path, CDK change): confirmed the widened `Household` payload leaks nothing new to household members (the same `buildGraphQLHousehold` helper `Query.household`/`joinHousehold`/`rotateInviteCode` already return, including co-members' emails, an already-accepted exposure within one household under this app's trust model), and confirmed this slice does not worsen the standing "authorize once, hold for connection life" exposure already documented for `onPantryChanged`/`onRecipeChanged` (§14.2.8's own closing note).

- Region: `ap-south-1` (Mumbai) primary; `us-east-1` fallback for Bedrock only if needed.
- Backend runtime: Node.js 20 + TypeScript on Lambda.
- IaC: AWS CDK v2 in TypeScript, 6 stacks.
- Repo: monorepo with pnpm workspaces (+ Flutter as a peer module).
- Auth: Cognito with Google IdP only; `amplify_auth_cognito` for OAuth, hand-rolled elsewhere (see amendment above).
- API: AppSync GraphQL with Lambda resolvers; subscriptions per (household, entity-type).
- DB: Aurora Serverless v2 Postgres with auto-pause ON, direct connections by default — RDS Proxy conditional (see amendment above).
- Cache + rate limits: DynamoDB single table with TTL.
- Storage: two S3 buckets (uploads private, exports 30-day lifecycle).
- AI: Bedrock Claude Sonnet (vision + complex text) + Haiku (structured extraction + short summaries); prompts versioned in code; every response schema-validated.
- Push: FCM (free).
- Analytics: PostHog.
- Environments: dev + prod; no staging.
- CI/CD: GitHub Actions.
- Frontend state: Riverpod (mobile), urql (web).
- Row-level security in Postgres, enforced defense-in-depth alongside Lambda-level auth checks.
