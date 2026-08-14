# Parimaan — Product Requirements Document

**Version:** 0.3
**Owner:** Amogh Kulkarni
**Last updated:** 2026-07-28
**Status:** Draft — pending review

**Changelog v0.2 → v0.3:**
- Meal structure config is now MAX slots per meal, not required fills. A 2-2-2 config allows 0–2 of each type per meal.
- Swiggy/Amazon direct integrations removed from all roadmap entries. MVP is share-as-image; no future integration promised until public partner APIs exist.
- Added §17 Cost analysis (setup + monthly beta + monthly at 100 households + reduction levers).

**Changelog v0.1 → v0.2:** Removed drag-based meal planning UX in favor of "+ add" pattern. Added household-level subscription model (households pay, not users; 5-member cap in MVP). Added meal structure configuration and cuisine preference configuration. Added recipe roles and rotation model. Free-form AI recipe entry moved to MVP. Shopping list gets "have it" flow + smart staples exclusion + AI staples note. Swiggy/Amazon direct cart integration replaced with share-as-image (no viable public API). SSO narrowed to Google only. Push notifications moved into MVP. Analytics: PostHog. Open questions on library sourcing, household cap, offline, i18n, trademark resolved.

---

## 1. Elevator pitch

**Parimaan** is a household-shared, mobile-first meal planning and pantry app built for Indian kitchens.

You plan the week's meals on your phone, the shopping list falls out automatically, and everyone in the house sees the same pantry, plan, and list in real time. AI helps by reading a photo of your shelf to update the pantry, suggesting recipes based on what you already have, and turning your free-form recipe notes into structured recipes you can plan with.

The name — *parimaan* (परिमाण) — is Sanskrit/Hindi for **measure** or **quantity**, which is the whole game: knowing what's in the kitchen, what needs to be cooked, and what still needs to be bought.

---

## 2. Problem

Cooking at home involves three interlocking questions asked constantly:

1. **What are we eating this week?**
2. **What do we already have?**
3. **What do we need to buy?**

Every existing app answers one of these well and the other two poorly. In Indian households the problem is worse because:

- Recipe apps are US-centric — wrong units (cups vs. katori/vati), wrong ingredients (no dal categories, no ghee vs. oil distinction), wrong cuisine tags.
- Pantry apps assume one shopper, one cook, one phone. In practice, kitchens are shared — spouse, parents, in-laws, kids, roommates all interact with the same pantry.
- Meal planning is done on paper, in WhatsApp messages, or in the head of one person, which breaks the moment that person is unavailable.

Parimaan collapses the three questions into a single shared surface for the household.

---

## 3. Target user

Parimaan is built for **households, not individuals**.

A household is any group that shares a kitchen — nuclear family, joint family, roommates. Anyone with an invite code can join, and everyone sees the same data.

### Personas

**Primary — The Planner (P1)**
The person who mostly decides what gets cooked and shops most of the time. Also the **household's primary user** (see §8) — the account holder responsible for the subscription (post-MVP) and household-level settings.

**Secondary — The Contributor (P2)**
Other cooks or shoppers in the household. Wants: to see the plan, mark things off the list when they buy them, add "we're out of X" from wherever they are.

**Tertiary — The Passenger (P3)**
Household members who don't cook but want to know what's for dinner and occasionally suggest things. Read-mostly, low-touch write.

The MVP does not model roles beyond "primary" vs. "member" — permission granularity lands in v1.1.

---

## 4. Competitive landscape

Short scan of the space and where the gap sits:

| App | Strength | Weakness for our use |
|---|---|---|
| **AnyList** | Best-in-class shared shopping lists, real-time sync | No meal planning depth, no Indian recipe/ingredient support, no pantry AI |
| **Paprika** | Great recipe manager, URL import, offline-first | Solo-user, no household sync, no pantry, no meal-plan → list flow |
| **Whisk / Samsung Food** | Recipe + shopping + some AI | US-centric, cluttered, ad-heavy, weak on India cuisine |
| **Mealime** | Slick meal-plan → grocery list flow | Rigid curated plans, no user recipes, US-only |
| **SuperCook** | "Cook from what you have" — closest to our AI recipe angle | Poor Indian coverage, no pantry management, no household model |
| **Kitchen Stories** | Beautiful content-first recipe app | Not a management tool at all |
| **DishGen / ChefGPT** | LLM-generated recipes | Novelty, no pantry integration, no household |

**The gap Parimaan fills:** *India-first* + *household-shared by default* + *AI-assisted pantry, planning, and recipe entry*. No single app does all three today.

**Positioning statement:**
> For Indian households where multiple people share the kitchen, Parimaan is a meal-planning and pantry app that keeps everyone on the same page — unlike Paprika or Mealime which are built for a single US-based cook, Parimaan is shared, India-native, and uses AI to eliminate manual data entry.

---

## 5. Product principles

1. **Shared by default, priced by household.** Every screen assumes multiple people can view or edit. Subscriptions (future) attach to the *household*, not the user — one household pays, everyone benefits.
2. **Phone-first, kitchen-friendly.** The user is often standing at the counter with wet or oily hands. Big touch targets, minimal typing, no small dropdowns. **No drag-and-drop for core actions** — the app is used one-handed while cooking or shopping. Use taps and "+" affordances instead.
3. **India-native, not India-translated.** Units, ingredients, cuisines, and dietary tags are modeled for how Indian kitchens actually work.
4. **AI reduces friction; it does not replace the user.** The AI proposes; the human always confirms. No silent writes to the pantry from a photo, no silent recipe saves from a paste.
5. **Ship narrow before wide.** One core loop, done well, beats five loops done adequately.

---

## 6. Core user journey (MVP)

The one loop that must be excellent:

```
Sunday evening
  │
  ├─ Planner opens app → sees empty week
  ├─ Taps a day + meal slot → picker shows recipes filtered by that slot's role
  │  (e.g. tapping "Lunch → Sabzi 1" shows only sabzi recipes, prefers rotation)
  ├─ OR taps "Auto-fill week" → rotation populates empty slots respecting meal structure
  ├─ Shopping list is auto-generated: sum ingredients across recipes, subtract pantry,
  │  exclude staples (salt/masalas/tsp-scale items), group by category
  ├─ Planner reviews list:
  │   • For each item, can tap "Have it" → prompts for quantity → item moves to pantry,
  │     drops off the list
  │   • Sees an AI-generated staples note at the bottom:
  │     "You might need Kitchen King Masala this week — check you have some"
  ├─ Planner taps "Share list" → clean categorized image → shares to Swiggy /
  │  WhatsApp / Blinkit via native share sheet
  │
Monday–Saturday
  │
  ├─ Any household member opens list → checks off items as bought
  ├─ Bought items auto-added to pantry with expiry defaults (user can edit)
  ├─ Cook of the day opens today's recipe → cooks → marks "made"
  └─ Ingredients used in recipe deducted from pantry
```

Everything else in the app supports or extends this loop.

---

## 7. Feature scope

### 7.1 MVP (must ship in 6 months)

**Household**
- Create a household → become its **primary user** → get a 6-char invite code (alphanumeric, unambiguous — no O/0/I/1).
- Join a household by entering a code. Household member cap: **5** (primary + 4 members).
- A user can be primary of many households; a user can be a member of many households.
- Any member can rotate the invite code (invalidates previous).
- Members can leave. Primary user cannot leave without transferring primary role (transfer is post-MVP; in MVP, primary user is the household creator and stays as such).
- All pantry/recipe/plan/list data is scoped to `householdId`. No user-scoped data.

**Household configuration (settings)**
Set at household creation with sensible defaults, editable anytime by primary user:
- **Which meals to plan:** any subset of {Breakfast, Lunch, Snacks, Dinner}
- **Meal structure per meal type:**
  - Breakfast = 1 recipe (a "breakfast" recipe may bundle its sides — Idli+Sambar+Chutney counts as one recipe)
  - Snacks = 1 recipe
  - Lunch & Dinner = configurable structure with named slots. Default = `{Carb: 1, Sabzi/Dal: 2, Accompaniment: 1}`. **The configured number is the MAX per meal instance, not a required fill.** A `Carb: 2, Sabzi/Dal: 2, Accompaniment: 2` config lets a specific lunch have 0 carbs, 2 sabzi/dals, 1 accompaniment (or any 0..N within the caps). Auto-fill from rotation respects the caps and prefers full slates but never forces a slot.
- **Cuisine preferences (see §7.2)**
- **Dietary tags** (household-wide): veg / vegan / jain / eggetarian / gluten-free / dairy-free. Filters recipes at pick time.
- **Allergen warnings list**: free-list of allergens. When picking a recipe containing a matching ingredient, show a warning. (Ingredient normalization is v1.1; MVP does substring match — imperfect but useful.)
- **Skip ingredients list**: free-list ("no mustard oil", "no raw onion"). Suppresses those recipes/suggestions.

**Pantry**
- Manual add: name, quantity, unit, category (dal, spice, dairy, produce, dry goods, staple, etc.), optional expiry
- Edit / delete items
- Search + filter by category
- "Running low" flag (user-set threshold, or quantity < 20% of a user-defined "typical")
- Quantity auto-decrements when a recipe is marked "made" (best-effort; user can override)
- **Ingredient roles:** each pantry item has a `staple` flag (default false). Staples don't clutter the shopping list; they get a periodic "check on this" nudge instead.

**Recipes — user-created**
- **Structured entry:** title, description, servings, prep time, cook time, ingredients (name + qty + unit), steps, dietary tags, cuisine tag, **role** (see below).
- **Free-form AI entry (new in v0.2):** user types or pastes free-form text ("mom's rajma recipe, soak overnight, pressure cook 4 whistles, tempering with cumin and hing..."). LLM structures it into fields. **User confirms/edits before save** — never silent.
- Edit / delete / duplicate.

**Recipe roles (new in v0.2)**
Every recipe carries one primary role. Drives which meal slot it can fill:
- `breakfast` — self-contained breakfast (may include sides)
- `carb` — roti, paratha, rice, jeera rice, pulao base
- `sabzi_dal` — any sabzi, dal, or protein main
- `accompaniment` — raita, chutney, papad, salad, pickle
- `snack` — self-contained snack
- `sweet` — dessert
- `drink` — beverages (post-MVP scope for planning, but role exists)

**Recipe favorites (new in v0.2)**
- Any recipe (user-created, URL-imported, curated, or AI-generated) can be favorited.
- Favorite is a household-level flag — everyone sees the same favorites.

**Recipe rotation (new in v0.2)**
- Every recipe has an `in_rotation` flag (default: true when created).
- Rotation is scoped **per role** (a sabzi in rotation is a candidate for sabzi slots, not carb slots).
- "Auto-fill week" button: for each empty meal slot in the plan, pick a random-ish rotation recipe of the matching role, weighted to avoid recent repeats.
- "Regenerate week" button: same, but overwrites existing choices. Confirmation required.
- User can toggle a recipe out of rotation without deleting.

**Recipes — URL import**
- Paste a URL → parse JSON-LD `Recipe` schema → prefill form
- User confirms/edits + assigns role before saving (never silent import)
- Graceful failure with copy-paste fallback

**Recipes — curated starter library**
- Ship with **30 North Indian + 20 South Indian** recipes, hand-created by the founder team, spanning: carbs, sabzis, dals, chicken, egg, salads/raitas/kozhambu variants, and a mix of everyday and weekend dishes
- Each pre-tagged with role, cuisine, dietary flags
- User can favorite / edit / duplicate any curated recipe

**Meal plan**
- 7-day calendar view; each day shows only the meal types the household has enabled
- Add via tap: tap a slot → picker filtered by role → pick recipe (favorites and rotation surfaced first)
- Copy day, copy week, clear day, clear week
- "Mark as made" on a scheduled recipe → deducts pantry
- Auto-fill / regenerate week (see rotation above)

**Shopping list**
- Auto-generated from meal plan: sum ingredients across recipes, subtract pantry, group by category
- **Smart staples exclusion:** any ingredient measured in tsp/tbsp/pinch/to_taste, OR flagged as a household `staple`, OR in the staples category (salt, spices, oils, ghee) is excluded from the main list
- **AI-generated staples check note** at the bottom: LLM inspects the week's recipes and produces a short list of staples that might need topping up ("You might want to check: Kitchen King Masala, jeera, hing")
- **"Have it" flow:** any item on the list can be marked "Have it" — prompts for quantity, then moves the item to pantry and drops it off the list
- Manual add of one-off items
- Check off items when bought (any household member) → item enters pantry with default expiry
- **Share list:** exports the list as a clean categorized image and opens native share sheet → send to Swiggy / WhatsApp / Blinkit / Instamart / anywhere. No direct cart API integration is possible today (see §15 Risks).
- Live, shared view — no "share to phone" step needed

**Auth**
- **Google SSO only** (via Cognito Google Identity Provider). No email/password, no other providers in MVP.
- One user, N households (as primary and/or member).

**Web dashboard (read + limited edit)**
- View pantry, meal plan, shopping list
- Add / edit recipes (easier on desktop, especially for URL import and free-form AI entry)
- Household settings management (meal structure, cuisine, dietary — desktop is easier for config UI)
- **NOT on web MVP:** pantry photo AI, meal-plan calendar interactions (view-only). Full parity comes in v1.1.

**Push notifications (moved to MVP in v0.2)**
- Shopping list changes ("New items added to shopping list")
- Today's meals reminder ("Today's dinner: Rajma Chawal")
- Pantry expiry warnings ("Paneer expires tomorrow")
- Household activity ("Priya joined the household")
- Per-user notification preferences

### 7.2 AI features in MVP (deliberately narrow)

**AI feature 1 — Photo pantry helper**
- User snaps a photo of a shelf/fridge
- Vision model (Bedrock Claude 3.5 Sonnet or Anthropic API) returns *proposed* pantry items with quantities
- **User reviews and confirms every item** before it's written to pantry
- Positioned as a batch-entry helper, not an autonomous scanner
- In-product copy: "AI suggests, you approve"

**AI feature 2 — "Cook from pantry" recipe suggestions**
- One-tap "what can I cook now?" → LLM takes pantry contents + household dietary tags + cuisine prefs + user vibe input ("quick / weekend / kid-friendly")
- Returns 3 recipe suggestions, each with ingredients grounded in current pantry (highlighted) + a small "missing" list
- User can save any suggestion to their recipe library (assigns role, joins rotation)

**AI feature 3 — Free-form recipe parser (new in v0.2)**
- User types / pastes / dictates free-form recipe text
- LLM structures into title, servings, ingredients (name + qty + unit), steps, and proposes a role + cuisine + dietary tags
- User confirms and edits before save

**AI feature 4 — Staples check note (new in v0.2)**
- LLM inspects the week's meal plan
- Produces a short human-readable note appended to the shopping list: "Staples you may want to check this week: X, Y, Z"
- Non-blocking, no writes

**NOT in AI MVP:** free-form open-ended recipe generation, allergen detection from photos, receipt OCR, personalized recommendation engine, chat interface, cooking-mode voice assistant.

### 7.3 Cuisine preference model (new in v0.2)

Two-tier taxonomy, configured at household level:

- **Tier 1 (mandatory, multi-select):** North Indian, South Indian, Pan-India, Indo-Chinese, Continental
- **Tier 2 (optional, multi-select):** unlocks after Tier 1
  - Under North Indian: Punjabi, UP/Bihari, Rajasthani, Gujarati, Marathi
  - Under South Indian: Tamil, Kerala/Malayali, Andhra/Telangana, Karnataka
  - Under East (separate top-level): Bengali, Odia, Assamese
- **"More of / less of" bias:** each selected sub-cuisine gets a weight (more / same / less). Biases rotation, curated library sort, and AI suggestions — does NOT hard-filter.
- Skip-ingredients list (see settings above) hard-filters.

### 7.4 Payment / subscription model (design now, ship post-MVP)

- MVP is **free** for all households, no cap on features.
- Data model designed from day one for household-level subscriptions:
  - `households.subscription_status` (free | trial | active | past_due | cancelled)
  - `households.plan_id`, `households.stripe_customer_id` (nullable, populated post-MVP)
  - `households.primary_user_id` — the payer when subscriptions ship
- **Model:** one household pays one subscription; ALL members access all features. Not per-seat.
- **Post-MVP pricing hypothesis** (not decided): ~₹149–₹299/month per household with a free tier that caps AI-feature usage. Stripe India or Razorpay for payments.

### 7.5 Post-MVP roadmap (v1.1, v1.2, later)

**v1.1 — depth (roughly months 7–10)**
- Household roles beyond primary/member (viewer, admin)
- Primary-user transfer
- Ingredient normalization layer → precise allergen warnings
- Receipt OCR (AWS Textract) → propose pantry adds
- Full AI recipe generator (constraints: cuisine, time, ingredients on hand, dietary)
- Web dashboard: full parity with mobile including meal plan editing
- iOS/Android widgets (today's meal, shopping list)
- Cooking mode: step-by-step, screen stays on, hands-free voice next
- Barcode scan for packaged items
- Subscription billing (Stripe/Razorpay); pricing decision

**v1.2 — polish, growth, integrations (roughly months 11–14)**
- Nutrition macros (per recipe, per day) — Indian food nutrition DB is the bottleneck
- Meal-plan templates ("standard week", "festival week", "guests coming")
- Recipe scaling (double, halve)
- Meal-slot flexibility beyond MAX caps (e.g. min-required slots, "must have 1 carb" rules)
- Multi-language UI (Hindi, Marathi, Tamil, Kannada) using Flutter `intl` — string layer designed for it from day one
- Cross-household recipe sharing (deep link)

**Explicitly out of scope forever (or until proven necessary)**
- Social feed / discovery of other households' plans
- Restaurant/dine-out logging
- Diet coaching / weight-loss features
- Full nutrition tracking with goals
- Payments/marketplace for groceries directly
- **Direct cart integrations with Swiggy Instamart, Amazon Fresh, Blinkit, Zepto** — none of these have public consumer-cart APIs. Parimaan supports share-as-image only. If a partner API opens up years from now, we revisit — not a roadmap commitment.

---

## 8. Household & auth model

Invite-code driven, household-level subscription (future), primary-user for accountability.

### Data shape
```
User ─┬─ HouseholdMembership ─┬─ Household ─── primary_user_id (FK → User)
      │                       │             └── invite_code (unique, rotatable)
      │                       │             └── subscription_status (design; unused in MVP)
      │                       │             └── settings (JSON: meals, structure, cuisine, dietary)
      │                       │
      │                       └── role: 'primary' | 'member'
      │
      └─ (a user can be primary in N households and member in M households)
```

### Rules
- Any authenticated user can create a household. They become its **primary user** and a member.
- Creating a household mints a 6-char invite code (unambiguous alphanumeric).
- Any user with the code can join, up to a hard cap of **5 members total** (primary counts as 1).
- Joining a full household surfaces "This household is full" and offers to notify primary user (v1.1).
- Any member can rotate the invite code (invalidates the previous code).
- Any *non-primary* member can leave the household.
- **Primary user cannot leave in MVP.** Transfer of primary role is v1.1. This is enforced to protect the eventual subscription owner.
- All pantry/recipe/plan/list/settings data is scoped to `householdId`.
- Auth: **Google SSO only** via Cognito Google Identity Provider.

---

## 9. Data model (starting point)

Ports the existing Supabase schema; adds household scoping, primary user, meal structure, cuisine, roles, and subscription placeholders.

```
households
  id, name, invite_code (unique), primary_user_id (FK users),
  subscription_status (default 'free'), plan_id (nullable),
  stripe_customer_id (nullable), created_at

household_settings
  household_id (PK, FK households),
  meals_enabled (jsonb array: ['breakfast','lunch','dinner','snacks']),
  meal_structure (jsonb: { lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 }, ... }),
  cuisine_tier1 (jsonb array),
  cuisine_tier2_weights (jsonb: { punjabi: 'more', bengali: 'same', ... }),
  dietary_tags (jsonb array),
  allergens (jsonb array of strings),
  skip_ingredients (jsonb array of strings),
  updated_at

household_memberships
  id, household_id, user_id, role ('primary' | 'member'), joined_at

users            (managed by Cognito, minimal mirror table)
  id, email, display_name, avatar_url, created_at

recipes
  id, household_id, source_type (user|url|curated|ai|freeform_ai),
  source_url, source_raw_text (nullable, for freeform_ai),
  title, description, servings, prep_min, cook_min,
  cuisine_tier1, cuisine_tier2 (nullable),
  dietary_tags (jsonb array),
  role (enum: breakfast|carb|sabzi_dal|accompaniment|snack|sweet|drink),
  in_rotation (bool, default true),
  is_favorite (bool, default false),
  created_by, created_at

recipe_ingredients
  id, recipe_id, name, quantity, unit, category, notes,
  is_staple (bool, default false; inherited from ingredient category)

pantry_items
  id, household_id, name, quantity, unit, category,
  is_staple (bool, default false),
  expiry_date, low_threshold, added_by, added_at, updated_at

menus
  id, household_id, week_start_date

menu_items
  id, menu_id, recipe_id, day_of_week (0–6),
  meal_slot (breakfast|lunch|dinner|snacks),
  slot_role (carb|sabzi_dal|accompaniment|breakfast|snack),
  servings_override, made_at (nullable)

shopping_lists
  id, household_id, generated_from_menu_id, created_at, closed_at,
  ai_staples_note (text, nullable)

shopping_list_items
  id, shopping_list_id, name, quantity, unit, category, source_recipe_id (nullable),
  purchased (bool), purchased_by, purchased_at,
  moved_to_pantry (bool, default false)

notification_preferences
  user_id, household_id,
  channels: { list_changes: true, meal_reminder: true, expiry: true, activity: true }
```

Notes:
- Ingredients are free-text in MVP. Normalization layer (canonical `ingredients` table with aliases) is v1.1 and unlocks precise allergen warnings.
- Units stored as strings from a small enum: `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `katori`, `vati`, `piece`, `bunch`, `to_taste`.
- Staples exclusion rule (shopping list): exclude if `unit ∈ {tsp, tbsp, pinch, to_taste}` OR `is_staple = true` OR `category ∈ {spice, masala, salt, oil}`.

---

## 10. Tech stack

### Mobile
- **Flutter (3.x)** for iOS + Android
- **Riverpod** for state management
- **Dio** for HTTP, `flutter_secure_storage` for tokens, `share_plus` for share sheet
- Real-time sync via AppSync GraphQL subscriptions
- Local cache with **Isar** or **Drift** — read-only offline in MVP (cheapest to build; full write-then-sync is v1.1)
- `intl` set up from day one for eventual i18n (v1.2)

### Web dashboard (light)
- **Next.js 15** (App Router) — reuses your existing TS/React familiarity
- Hosted on **AWS Amplify Hosting**
- Same GraphQL API as mobile

### Backend (AWS)
- **AWS Cognito** — auth. **Google Identity Provider only** in MVP.
- **AWS AppSync (GraphQL)** — API layer; native subscriptions handle household sync
- **AWS Lambda (Node.js/TS)** — resolvers and business logic
- **Aurora Serverless v2 Postgres** — relational data (schema above is inherently relational; scales to near-zero when idle)
- **S3** — pantry photos, recipe images, shopping list export images
- **CloudFront** — CDN
- **Amazon Bedrock — Claude 3.5 Sonnet** — vision (photo pantry) + text (recipe suggestions, freeform parse, staples note). Fallback to direct Anthropic API if Bedrock model unavailable in region.
- **AWS Textract** — receipt OCR (v1.1)
- **AWS Pinpoint** OR **Firebase Cloud Messaging** — push notifications (FCM likely simpler for Flutter)
- **CloudWatch + X-Ray** — logs and tracing
- **IaC:** **AWS CDK** in TypeScript

### Analytics
- **PostHog** — product analytics + session replay + feature flags + surveys. Free tier (1M events/mo). Open source; self-host on AWS if the app scales beyond free tier.

### Why AWS + Aurora vs. Amplify Gen 2 / Supabase
- Amplify Gen 2's DynamoDB-first data model fights our relational schema. CDK-based AWS primitives = more setup, better fit long term.
- Supabase would ship faster but the user chose AWS explicitly for the learning + long-term flexibility.

---

## 11. Success metrics

MVP is a success if, after 3 months of your household using it daily:

**Engagement**
- ≥5 meals planned per household per week (avg over trailing 4 weeks)
- ≥1 shopping list generated per household per week
- ≥60% of shopping-list items get checked off
- Auto-fill from rotation used at least once/week per household

**Retention**
- ≥3 households outside your own using it weekly by month 6
- Week-4 retention ≥50% for invited households

**Product quality**
- Photo pantry AI: ≥70% of proposed items accepted without edit
- Free-form recipe parser: ≥80% of parses accepted with ≤3 field edits
- URL recipe import: ≥80% success rate on top-20 Indian recipe blogs
- Real-time sync: household member sees another's edit within 5 seconds under normal network

**Anti-metrics**
- If more than 20% of pantry items are manually adjusted post-cook → auto-deduction is broken
- If shopping lists are heavily edited after generation → staples exclusion / structure logic is wrong
- If "Have it" flow is used on >30% of items → shopping list generation is over-including

---

## 12. Timeline (6 months, ~10 hrs/week)

**Month 1 — Foundations + Configuration**
- Flutter app scaffold, AWS account + CDK skeleton
- Cognito Google SSO
- Household create/join, invite code, primary-user model, 5-member cap
- Household settings screens: meals, meal structure, cuisine (Tier 1 + 2), dietary, allergens, skip-ingredients
- Empty-state screens

**Month 2 — Pantry + Recipes (manual + freeform AI)**
- Pantry CRUD, categories, staples flag, low-threshold
- Structured recipe CRUD with role assignment
- URL import (JSON-LD parser)
- **Freeform AI recipe parser** (Bedrock text)
- Real-time sync via AppSync subscriptions
- **Milestone:** ingredient/recipe CRUD complete, sync working

**Month 3 — Meal plan + Shopping list (the core loop)**
- 7-day calendar UI honoring configured meal structure
- Recipe picker filtered by role, favorites/rotation surfaced
- Rotation model + auto-fill week + regenerate week
- Shopping list generation with smart staples exclusion
- "Have it" flow → pantry
- Check-off → pantry sync
- **Milestone:** end-to-end core loop working

**Month 4 — Curated library + Sharing**
- Author 30 North Indian + 20 South Indian recipes (mix of carb / sabzi / dal / chicken / egg / salad / raita / kozhambu variants)
- Tag all with role, cuisine, dietary
- Shopping list "share as image" flow (categorized layout, share sheet integration)
- AI-generated staples check note appended to list
- Read-only web dashboard (Next.js)

**Month 5 — AI features + Push notifications**
- Photo pantry (Bedrock Claude vision) with confirm-before-write flow
- "Cook from pantry" suggestions
- Push notifications: shopping list changes, today's meal, expiry, activity
- Per-user notification preferences
- Fallbacks for AI failures (never block user)

**Month 6 — Polish + Beta**
- Onboarding, empty states, error states, offline read-cache
- PostHog analytics integration
- TestFlight + Play Console internal testing
- Invite 3–5 households to beta
- **Milestone:** MVP shipped

---

## 13. Assumptions

1. Household members trust each other with full-edit access (primary/member roles only in MVP).
2. JSON-LD `Recipe` schema coverage on Indian recipe sites is good enough for URL import. **Validate in week 1 of month 2** with 20 popular sites.
3. Bedrock Claude vision is accurate on Indian pantry items. **Prototype in week 1 of month 5** before betting month 5 on it.
4. Bedrock Claude is accurate enough at parsing freeform Indian recipe text (mix of English + Hindi/regional words, informal instructions). **Prototype in week 2 of month 2.**
5. Aurora Serverless v2 stays cheap at MVP scale. Ballpark: <$25/month for the first 6 months.
6. Founder learns Flutter/Dart during month 1. This will slow month 1 by ~30%.
7. Curated 50-recipe library can be authored in ~2 weeks by one person (month 4).
8. Google SSO through Cognito is sufficient for MVP audience (no push against adding email/OTP for users without Google accounts). If a beta tester pushes back, we add email/OTP in v1.1.

---

## 14. Resolved decisions

Open questions from v0.1, now decided:

1. **Recipe library sourcing:** hand-authored by founder. 30 North Indian + 20 South Indian recipes covering carbs, sabzis, dals, chicken, egg, salads/raitas/kozhambu. Month 4.
2. **Household size cap:** 5 members total (primary + 4).
3. **Data export:** not in scope. No commitment made in UI.
4. **Offline behavior:** cheapest — read-cache only. Full offline write-and-sync deferred to v1.1.
5. **Multi-language UI:** post-MVP (v1.2). Design string layer with Flutter `intl` from day one so retrofit is cheap.
6. **Analytics stack:** PostHog. Free tier + open source + all-in-one + easy self-host later.
7. **Push notifications:** MVP. FCM via Cognito or direct. Minimal set: list changes, meal reminder, expiry, activity.
8. **Trademarking Parimaan:** don't file yet. Do the cheap protective steps now (buy `parimaan.app` / `.in` / `.com`, grab @parimaanapp on socials, run a free IP India Class 9 + 42 + 30 search). File after MVP + ~100 users.

## 14b. New open questions (from v0.2 changes)

1. **Freeform AI parser accuracy on regional-language recipe text.** If parses fail often, do we default back to structured entry with a suggestion overlay?
2. **"Have it" flow quantity input.** Do we default the quantity to the shopping list quantity, or make user enter every time? Lean: default + optional edit.
3. **Rotation weighting.** Simple random-with-recency-avoidance in MVP? Or a proper "haven't cooked this in 3 weeks" priority queue? Lean: simple in MVP.
4. **Primary-user leaving.** If primary must leave (real-world scenario) and transfer isn't in MVP, do we support "delete household" as an escape hatch? Lean: yes.
5. **Meal structure edge cases.** What if a household enables Snacks but only sometimes has a snack? Meal plan slots would be empty many days. Lean: empty slot is fine, no forcing.
6. **AI cost budget.** At ~1000 AI calls / household / month (photo pantry + suggestions + parses + staples notes), Bedrock costs could reach $2–5 / household / month. Fine for MVP. Sets pricing floor for subscriptions.
7. **Notification consent UX** — iOS requires explicit permission. Where in onboarding do we ask, and what happens if denied?

---

## 15. Risks

**Technical**
- Vision AI accuracy on Indian pantry items is unproven → prototype early (start of month 5), manual entry is always available fallback
- Freeform recipe parser accuracy is unproven → prototype early (month 2), structured entry always available
- Real-time sync via AppSync is new territory → reserve a full week for sync implementation
- CDK + AWS + Flutter learning curve → start CDK in month 1 with just Cognito, layer services one at a time
- Google SSO via Cognito Identity Provider has known configuration pitfalls → allow 2 days in month 1

**Product**
- No public partner APIs for Swiggy Instamart, Blinkit, Amazon Fresh, Zepto — the "share as image + native share sheet" is a real UX compromise. Users may perceive it as less magical than "auto-fill my Instamart cart." Mitigation: make the exported list beautiful (categorized, copy-friendly formatting) so the paste experience is fast.
- 5-member cap will be tight for joint families (7–8 members not uncommon). Mitigation: v1.1 raises cap; MVP flags this in onboarding.
- Solo dev + 6 months = the app will feel unpolished vs. commercial competitors. Testers will compare unfairly.

**Business**
- Household-level pricing is the right ethical + practical model but reduces per-user revenue vs. per-seat pricing. Mitigation: cap AI-heavy features in free tier post-MVP; premium unlocks all AI.
- AI inference costs must be modeled before setting a subscription price.

---

## 16. Appendix — decisions log

- **Platforms:** Mobile (iOS+Android via Flutter) + light web dashboard.
- **Existing prototype:** Archived. Fresh start on AWS + Flutter. Schema ported as reference only.
- **Core job:** Meal planning + calendar is the anchor.
- **Region:** India-first. Not bilingual in MVP.
- **Household model:** Invite-code, primary + member roles, cap of 5 members, primary is subscription-owner (post-MVP).
- **Monetization:** Household-level (not per-user). Free in MVP; ~₹149–₹299/month/household hypothesis for post-MVP. Design data model for it now.
- **UX principle:** No drag-and-drop for core actions. Tap-based, "+ add" pattern throughout.
- **Meal planning:** Meal structure config sets a MAX per named slot (e.g. 2-2-2). A given meal instance can have 0..N of each within the caps — no forced fills. Min-required slot rules are v1.1.
- **Rotation:** Per-role. Auto-fill respects meal structure. `in_rotation` flag on every recipe (default true).
- **AI scope (MVP):** Photo pantry (confirm-before-write), "cook from pantry" suggestions, freeform recipe parser, staples check note.
- **Auth:** Google SSO only in MVP.
- **Shopping list:** Smart staples exclusion (tsp/tbsp/staples), AI staples note, "Have it" → pantry flow, share-as-image only. No cart integration on the roadmap.
- **Backend:** AWS via CDK, Aurora Postgres (not DynamoDB), AppSync for GraphQL + real-time.
- **Analytics:** PostHog.
- **Push notifications:** MVP.
- **Offline:** Read-cache only in MVP.
- **i18n:** Design for it (Flutter `intl` from day 1), ship it post-MVP.
- **Timeline:** 6 months, ~10 hrs/week, phased month-by-month.

---

## 17. Cost analysis

**Version note (2026-08-07):** revised after discovering AWS replaced the old "12-months-free" model with a Free Plan / Paid Plan system for accounts created after 2025-07-15 (ours). Joining AWS Organizations (required for our locked dev+prod account architecture) automatically upgrades an account from Free Plan to Paid Plan — this is expected and unavoidable given our architecture, not a mistake. See §17.2a for what this actually changes.

Ballpark numbers; final costs depend on region (Mumbai/`ap-south-1` recommended), usage patterns, and whether AWS Activate credits are approved.

### 17.1 One-time setup

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | **$99 / year** | Required for TestFlight + App Store. Recurring annually. |
| Google Play Developer | **$25 one-time** | Then never again. |
| Domain (`parimaan.app` + `.in`) | **~$25 / year** | Buy both to defend the name. |
| AWS account, IDEs, design tools | $0 | Free. |
| **Upfront to reach beta** | **~$150** | |

### 17.2 Monthly running cost — beta scale (5 households × ~4 users = ~20 active users)

| Service | Est. cost/mo | Notes |
|---|---|---|
| Aurora Serverless v2 Postgres (auto-pause enabled) | **$8–15** | Auto-pause is REQUIRED — without it, ~$50/mo baseline. Enable at cluster creation. **Never free-tier-eligible under any AWS model, old or new** — real cost driver #1. |
| Bedrock (Claude for AI features) | **$3–5** | Sonnet for vision + cook-from-pantry, Haiku for freeform parser + staples note. **Never free-tier-eligible under any AWS model** — real cost driver #2. |
| AppSync (GraphQL + subscriptions) | **<$1** | 250K queries/mo free; beta usage well within. |
| Lambda | **$0** | **Always Free** — 1M invocations + 400K GB-seconds/mo, resets monthly, never expires, unaffected by Free/Paid Plan status or account age. |
| DynamoDB (AI cache + rate limits) | **$0** | **Always Free** — 25GB storage + 200M requests/mo, same permanence as Lambda. |
| S3 (photos + list images) | **<$1** | ~2GB at beta. **Correction:** for accounts created after 2025-07-15 (ours), S3 no longer has its own standing free allowance — usage draws from the $200 signup credit (§17.2a) instead. Trivial in absolute dollars either way. |
| CloudFront | **$0–1** | Unverified whether this is Always-Free-equivalent or draws from the $200 credit pool for new accounts — validate against the live Pricing Calculator once deployed rather than assume. |
| Cognito (Google SSO) | **$0** | 50K MAU tier — same unverified-for-new-accounts caveat as CloudFront. |
| Route 53 (DNS) | **$0.50** | 1 hosted zone. |
| Amplify Hosting (web dashboard) | **$0** | Free tier — same unverified-for-new-accounts caveat as CloudFront. |
| SSM Parameter Store (config) | **$0** | Standard tier is free — use instead of Secrets Manager for non-secret config. |
| FCM push notifications | **$0** | Firebase Cloud Messaging is free (Google product, unaffected by AWS's plan changes). |
| CloudWatch + X-Ray | **$0** | Beta usage under free tier. Set log retention to 7 days. |
| PostHog analytics | **$0** | 1M events/mo free tier (PostHog's own, unaffected by AWS's plan changes). |
| Apple Dev amortized | **$8.25** | $99/yr ÷ 12. |
| Domain amortized | **~$2** | $25/yr ÷ 12. |
| **Total** | **~$25–35 / mo** | **Unchanged in dollar terms** — the items whose free-tier status is now uncertain (S3, CloudFront, Cognito, Amplify) were always sub-$1–2/mo combined even at full pay-as-you-go rates. |

**With AWS Activate credits ($1,000):** effective cost drops to **~$10–15/mo** for the first 4–5 years of beta scale — the credits alone cover almost all AWS spend at beta. **This is now the load-bearing number**, not the $200 signup credit (see §17.2a) — Activate is what actually offsets Aurora + Bedrock, the two line items no free tier has ever covered.

### 17.2a AWS Free Plan / Paid Plan — what actually changed (discovered 2026-08-07)

For AWS accounts created after 2025-07-15, AWS replaced the old 12-month free tier with a **Free Plan / Paid Plan** system:

- **Free Plan:** up to $200 in credits ($100 on signup + $100 more for using services like EC2/Bedrock), lasts up to 6 months or until credits deplete, whichever is first. Free Plan accounts are restricted from some expensive services and are **typically not eligible for AWS Activate**.
- **Paid Plan:** full access to all services, standard pay-as-you-go pricing beyond free allowances. **Any unused Free Plan credit carries forward and continues to apply for up to 12 months from original signup date** — upgrading does not forfeit credit.
- **Automatic upgrade trigger:** joining AWS Organizations (among other actions — Control Tower, AWS Partner Network, Enterprise Agreement) **automatically upgrades an account from Free Plan to Paid Plan.** This happened to our dev account the moment it was linked to prod under one Organization, per the locked Q3 decision — expected, not a mistake, and actually a **necessary precondition** for Activate eligibility, not an unwanted side effect.
- **Always Free services** (Lambda, DynamoDB, and 30+ others) are unaffected by any of this — they stay free forever within monthly limits regardless of Free/Paid Plan status or account age.

**Net implication:** the $200 signup credit is a short bridge (≤6 months), not the multi-year cushion the old free tier provided. **AWS Activate's $1,000 becomes the real cost lever for this plan**, not a nice-to-have — apply as soon as sole prop registration confirms (task #4).

### 17.3 Monthly running cost — 100 households (~400 users, projected v1.1)

| Service | Est. cost/mo |
|---|---|
| Aurora Serverless v2 (~1 ACU avg) | $80–110 |
| Bedrock | $50–80 |
| AppSync + Lambda | $5–15 |
| S3 + CloudFront | $10–20 |
| PostHog (may exceed free tier) | $0–50 |
| Everything else | $15–25 |
| **Total** | **~$160–300 / mo** |

**Break-even math:** at a hypothesis of ₹199/mo/household with 30–50% conversion of 100 households = ₹6K–₹10K = **$70–$120/mo revenue**. Costs exceed revenue until roughly **250–400 paying households**. MVP is not trying to break even; this is a planning baseline.

### 17.4 Cost-reduction levers (ranked by impact)

1. **Apply for AWS Activate Founders** ($1,000 in credits, minimal qualification bar) as soon as a company entity exists. **Biggest single lever, and now a confirmed necessity, not just an optimization** — see §17.2a. Free Plan accounts aren't Activate-eligible, and the $200 signup credit only bridges ~6 months of Aurora+Bedrock spend on its own.
2. **Aurora Serverless v2 auto-pause ON** at cluster creation. Cuts DB cost ~70% at beta scale. Non-negotiable.
3. **Haiku for text-only AI tasks, Sonnet only for vision + complex reasoning.** Cuts Bedrock cost ~40%. Route freeform parser and staples note to Haiku; keep photo pantry and cook-from-pantry on Sonnet for quality.
4. **Compress images client-side before upload** — Flutter downscales pantry photos to 1024px longest edge, JPEG q80. Cuts Bedrock vision tokens ~40% and S3 storage.
5. **Cache safe AI responses** — cook-from-pantry cached 30 min per (household, pantry hash); staples note cached per shopping list. ~20–30% AI cost cut.
6. **SSM Parameter Store, not Secrets Manager** — Parameter Store standard is free; Secrets Manager is $0.40/secret/mo.
7. **FCM (Firebase) for push, not Pinpoint** — FCM is free.
8. **CloudWatch log retention 7 days** for non-production logs; default is "never expire" and gets expensive at scale.
9. **Post-100-household lever:** if Aurora Serverless v2 gets expensive at higher steady-state usage, switch to a `db.t4g.small` on-demand RDS instance (~$27/mo flat). Sacrifices scale-to-zero but is cheaper at consistent 1+ ACU load.

### 17.5 What NOT to optimize (yet)

- Skipping Amplify Hosting for a direct S3+CloudFront setup saves ~$0 at MVP scale and adds work.
- Skipping AppSync for a custom WebSocket layer saves ~$1/mo and costs weeks of work.
- Moving off AWS to a mixed stack (Neon Postgres, Vercel, Supabase) would save maybe $10/mo at beta scale — not worth the fragmentation given the AWS-first learning goal.

### 17.6 Cost assumptions

- Region: `ap-south-1` (Mumbai). Pricing quoted is approximate for that region.
- Household usage patterns for AI feature calls: photo pantry 2–4×/wk, cook-from-pantry 2–4×/user/wk, freeform parse 1–2×/wk, staples note 1×/shopping list.
- Aurora Serverless v2 pricing varies by ACU-hours; auto-pause behavior assumed idle 20 hrs/day at beta.
- Bedrock pricing is model-dependent and evolves; numbers are floors at current published rates.
- **Recheck all numbers before committing** — AWS pricing changes; validate against the pricing calculator at build time.
