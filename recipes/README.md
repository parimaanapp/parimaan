# recipes/

Curated recipe seed data (JSON), loaded into new households on `createHousehold`
per locked decision Q8 (copy-per-household, not a shared table).

Currently **200 recipe seeds** across four folders: `north-indian/`,
`south-indian/`, `pan-india/` and `indo-chinese/`. Some dishes appear twice as
role variants (for example Appam, Idli, Dosa and Neer Dosa as a main and a
carb-role file). Near-duplicates under different titles are not kept (the egg
bhurji trio is one recipe, Anda Bhurji Masala); see `docs/catalog/decisions.md`.
Ingredient names must be catalog canonical names, and one real-world item has
one name (for example `Garlic`, where `piece` means a clove).

See `docs/E2E_MVP_PLAN.md` §4 and §33.5 for how the set grew, and
`docs/PRD.md` §9 for the recipe model these files must conform to.

## Seeding and top-up

- **New households**: `createHousehold` copies every recipe in this tree into the household (two batched multi-row inserts, canonical ingredients).
- **Existing households**: a household created before a recipe was added does not get it automatically. Run `pnpm --filter ./api recipes:topup` (dry run) and then `pnpm --filter ./api recipes:topup -- --execute` per environment. It adds only the recipes whose title and role the household does not already have, so it is safe to repeat. Details in `docs/catalog/README.md`.
