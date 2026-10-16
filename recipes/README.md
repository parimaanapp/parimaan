# recipes/

Curated recipe seed data (JSON), loaded into new households on `createHousehold`
per locked decision Q8 (copy-per-household, not a shared table).

Populated in **month 4 / Phase 4**. Empty during Phase 0–3.

See `docs/E2E_MVP_PLAN.md` §4 for the week this lands, and `docs/PRD.md` §9 for
the recipe model these files must conform to.

## Seeding and top-up

- **New households**: `createHousehold` copies every recipe in this tree into the household (two batched multi-row inserts, canonical ingredients).
- **Existing households**: a household created before a recipe was added does not get it automatically. Run `pnpm --filter ./api recipes:topup` (dry run) and then `pnpm --filter ./api recipes:topup -- --execute` per environment. It adds only the recipes whose title and role the household does not already have, so it is safe to repeat. Details in `docs/catalog/README.md`.
