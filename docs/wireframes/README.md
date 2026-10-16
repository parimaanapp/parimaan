# Wireframes and design deltas

| File | What it is | Status |
|---|---|---|
| `Parimaan Wireframes v2 (standalone).html` | The Claude Design wireframe bundle (50 mobile screens, 12 flows). Open in a browser. | Source of truth for **component** look and feel (icons, type, spacing, colour) |
| `component-alignment-v1.html` | Side-by-side of the app vs. the wireframe components, with the sign-off list | **Approved** items 1–6 and 8 |
| `weekly-plan-layouts-v1.html` | Weekly plan options A (4 columns), B (2×2 per day), C (3 columns) | **Decided**: B for four meals, C for one to three meals |

## Where the build deliberately differs from the wireframes (founder decisions)
| Area | Wireframe | Build decision |
|---|---|---|
| Bottom tabs | Today · Plan · Pantry · **List** | Today · Plan · Pantry · **Recipes**. The shopping list opens from Plan (and the week-confirmed screen). |
| Tab icons | Text glyphs ◉ ▦ ◈ ☰ (placeholders) | Drawn icons of the same shapes |
| First tab label | Today | Today (implemented) |
| Screen title | Centred Instrument Serif | Centred (implemented) |
| Back control | Small `‹` | Bold chevron, 44×44 tap target |
| Chips | Solid ink when selected, no check | Same (the app's ✓ prefix is removed) |
| AI badge | Soft haldi "◆ AI proposal" | Same (the app's blue pill is replaced) |
| Weekly plan (6.1) | Day rows × Bkfst/Lunch/Dinner columns | **Four meals:** 2×2 block per day, meal name under the ＋ and in each cell, no column header. **One to three meals:** one column per planned meal with a header. Snacks are a fourth meal. |
| Setup (flow 2) | Which meals → lunch structure → … | Adds Snacks to "Which meals?"; "Same structure as lunch" toggle with a dinner-structure page; titles read "Setup your Household"; dietary chips grouped (Eating style / Must also be) |
| Diet labels | veg, vegan, jain, egg-friendly, GF, dairy-free | Vegetarian, Non-vegetarian, Vegan, Egg friendly, Jain, Gluten free, Dairy free |
| Pantry categories | dal, spice, dairy, produce, dry goods, grain, oil, condiment, frozen, other | Adds Eggs, Meat & Fish, Bakery, Snacks, Beverages; labels Dal, Grain, Spice, Dairy, Eggs, Produce, Dry Goods, Oil, Meat & Fish, Condiment, Bakery, Snacks, Beverages, Frozen, Other |

See `docs/E2E_MVP_PLAN.md` §32 and §33, and `docs/catalog/decisions.md`.
