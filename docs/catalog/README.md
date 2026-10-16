# Ingredient catalog: how the CSV reaches the app (B2a) and how the app uses it (B2b)

`ingredients.csv` and `conversions.csv` in this directory are the source of truth. Everything below is data-driven; no code depends on row counts.

## Flow

1. **Edit the CSVs** (or regenerate them with `build_catalog.py`).
2. **Bundle**: `pnpm --filter ./api catalog:build` validates the CSVs and writes `api/src/catalog/data/ingredients.json` and `conversions.json` (sorted by id / scope+key+unit, stable). Commit both. `--check` verifies without writing.
   - `api/src/catalog/bundle.sync.test.ts` fails when the committed JSON differs from the CSVs, so a CSV edit without a rebuild cannot merge.
   - Validation (`api/src/catalog/buildBundle.ts`): unique ids and names, id format `[a-z0-9_]+`, category and its label match the approved set (E2E_MVP_PLAN.md section 32.6), `default_unit` is one of `allowed_units`, positive `piece_g` / `cup_g_override`, conversion keys exist. Ingredient-scope rows in `conversions.csv` are keyed by canonical name there and stored by id.
3. **Deploy**: the migration-runner Lambda (`api/src/migrationRunner/handler.ts`) runs migrations, then `syncCatalog`.
   - The JSON is statically imported, so esbuild inlines it into that Lambda; there are no runtime file reads.
   - `DataStack` passes `CatalogHash` (sha256 of the two JSON files and `domain/ingredientCatalog.ts`) to the custom resource, so a data-only change re-invokes the runner (CloudFormation only re-runs on property changes).
   - `syncCatalog` (`api/src/catalog/syncCatalog.ts`) compares its own content hash (bundle + `NORMALISER_VERSION`) with `catalog_sync_state` and exits early when equal. Otherwise, in one transaction under an advisory lock, it upserts `ingredient_catalog`, deletes ingredients that left the bundle, and replaces `ingredient_aliases` and `unit_conversions`. A failure rolls everything back and leaves the old hash.
4. **Read**: `Query.ingredientCatalog` and `Query.searchIngredients` read the three tables through `parimaan_app` (SELECT only) and cache them in module memory per Lambda container (10 minute TTL, empty results never cached). The cached snapshot also carries the conversion rows and a conversion lookup (B2b), read by one extra query.

## Tables (migration `1788700000000_ingredient-catalog.ts`)

| Table | Key | Notes |
|---|---|---|
| `ingredient_catalog` | `id` (slug) | `canonical_name` unique; `allowed_units text[]`, `default_unit` must be in it; `piece_g`, `cup_g` nullable |
| `ingredient_aliases` | `(alias_key, ingredient_id)` | `alias_key` is `normaliseKey(alias, { keepParentheticals: true })`. Composite key on purpose: colliding aliases (for example `magaz`, `lasun`) must stay visible so the resolver can report `ambiguous` |
| `unit_conversions` | `(scope, key, unit)` | scope `subcategory` (key = subcategory) or `ingredient` (key = ingredient id) |
| `catalog_sync_state` | `id = 1` | content hash of the last sync; not readable by the app role |

No RLS: global reference data, SELECT-only grant. The account-wipe tool leaves these tables alone (`GLOBAL_REFERENCE_TABLES`).

## Resolver rules (`api/src/domain/ingredientCatalog.ts`)

First hit wins, canonical names always before aliases:

1. exact canonical name, 2. exact alias, 3. singular/plural folding, 4. same words in any order (token set), 5. a lone token completed with `dal` when that resolves into the dal category (`tuvar` -> `tuvar dal` -> Toor Dal), 6. all of the above again after dropping `fresh`, `organic`, `large`, `small`, `medium`, `big`.

A key owned by more than one ingredient returns `ambiguous` with every candidate. Subsets of tokens never match ("tomato sauce" does not become Tomato). Parenthetical words are tried as part of the name first (`Bread (White)`), then dropped as prep notes (`Onion (chopped)`).

## Canonicalise on write and match by id (B2b)

Migration `1788800000000_canonical-ingredient-ids.ts` adds two nullable columns to `recipe_ingredients` and `pantry_items`:

| Column | Meaning |
|---|---|
| `ingredient_id` | FK to `ingredient_catalog(id)`, `ON DELETE SET NULL` (the deploy sync deletes ingredients that leave the bundle; the next backfill re-resolves). `NULL` = not resolved |
| `catalog_match` | `resolved`, `ambiguous`, `unresolved`, or `NULL` = not evaluated (rows from before B2b, or a save while the catalog was unavailable) |

### Write paths

Every path below resolves each name with `resolveIngredient` (module-cached catalog, `api/src/resolvers/ingredientCanonicaliser.ts`; pure logic in `api/src/domain/canonicaliseIngredient.ts`):

| Path | Behaviour |
|---|---|
| `createRecipe`, `updateRecipe` (when `ingredients` is sent), curated seeding in `createHousehold` | canonical name + `ingredient_id` + `catalog_match` per line |
| AI import / URL import / free-text parse | these Lambdas have no database access and only return a draft; the draft is saved through `createRecipe`, so it is canonicalised there |
| `addPantryItem`, `bulkAddPantryItems`, `updatePantryItem` (a rename re-resolves and clears a stale id) | canonical name + id |
| `haveIt`, `markPurchased` (pantry upsert) | the shopping-list name is resolved; the match against existing rows is by id first |

Rules:

- **Never fails a save.** A catalog load error or an empty catalog (sync not run yet) logs one structured line (`{"event":"catalog_unavailable",...}`, suitable for a CloudWatch metric filter) and the row is stored as typed with `catalog_match = NULL`; the backfill reconciles those rows. The cached catalog can be up to 10 minutes stale, so an id deleted by a sync may still resolve: inserts and pantry renames run inside a savepoint and, on that FK violation only, retry with `ingredient_id`/`catalog_match` NULL (logged as `ingredient_id_stale`).
- **Unresolved and ambiguous names are kept as typed**, `ingredient_id = NULL`, flagged. An ambiguous name never picks a candidate.
- **Nothing is lost silently.** What the typed name says beyond the canonical name is: bracketed parts the canonical name's own words do not cover (including an unbalanced tail such as `Onion (finely chopped`, and extra groups after a parenthesised canonical name such as `Ragi (Finger Millet, Whole) (sprouted)`), and filler words the resolver ignores (`fresh`, `organic`, `large`, `small`, `medium`, `big`). Recipe lines: that text is appended to `notes` ("Small potato" becomes `Potato`, notes `small`), de-duplicated by whole `;`-separated segment. Pantry rows have no notes column, so when anything would be lost the typed name is kept and only the id is recorded.
- **Unit conversion on write is narrow.** Only recipe lines, and only when the written unit is not in the ingredient's `allowed_units` AND `unit_conversions` (ingredient scope, then subcategory scope) defines a factor into an allowed unit. The quantity is converted, rounded to 3 decimals, and the original amount is appended to `notes` (`1.5 cup`). Any other unit is stored untouched. Pantry quantities and units are never rewritten.
- `category` and `is_staple` pass through unchanged, so salt and pepper stay staples.

### Read paths (`api/src/domain/shoppingListGeneration.ts`, `pantryDeduction.ts`)

- `ingredientsMatch`: when both sides have an `ingredient_id` the ids alone decide (so "tomato puree" never merges with "tomato paste" on name similarity); if either side has none, the previous normalised-name fuzzy match applies.
- Units merge through `createUnitConverter` (`domain/ingredientConversion.ts`): the physical families first (g/kg, ml/l/tsp/tbsp/cup, piece/dozen), then catalog factors through the ingredient's base unit (1 cup plus 190 g of basmati rice becomes 2 cup). Where the catalog defines nothing the lines stay separate; nothing is guessed. Catalog conversions are density and size estimates, the same trade-off a hand-converted list makes.
- Staple exclusion is unchanged (`isStaple`, staple unit, staple category).
- Used by shopping-list generation and regeneration, pantry subtraction, `markMade` deduction and the have-it / purchased pantry upsert.

### Backfill (existing households)

`pnpm --filter ./api catalog:backfill` (`api/scripts/backfillIngredientIds.ts`, logic in `api/src/catalog/backfillIngredients.ts`):

- **Dry run by default**: reads every row (no locks), prints counts (scanned, would update, resolved / ambiguous / unresolved per table) and the most frequent unmatched names (a curation backlog; no household data). `--execute` takes a session advisory lock (one backfill at a time) and commits every batch of 200 rows in its own short transaction, selecting with `FOR UPDATE SKIP LOCKED`: the state planned from is the state overwritten, a concurrent rename is never clobbered, nothing waits on app writes, and a failure keeps earlier batches. Rows a request had locked are skipped; re-run until `would update` / `updated` is 0.
- **Idempotent**: canonical names re-resolve to themselves and a converted unit is an allowed unit, so a second run changes nothing. It also picks up rows that did not resolve earlier once the catalog gains an alias.
- Needs a role that bypasses RLS (superuser or `BYPASSRLS`, as the data migrations do); it checks this and refuses otherwise.
- Environment: `PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD` (optional `PGSERVERNAME`). The catalog must already be synced. No deploy runs it; run it by hand per environment, dry run first.
