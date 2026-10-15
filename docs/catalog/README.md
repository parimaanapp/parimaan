# Ingredient catalog: how the CSV reaches the app (B2a)

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
4. **Read**: `Query.ingredientCatalog` and `Query.searchIngredients` read the three tables through `parimaan_app` (SELECT only) and cache them in module memory per Lambda container (10 minute TTL, empty results never cached).

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
