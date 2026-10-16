# Catalog decisions (founder sign-off record)

Applied to `src/*.txt`, rebuilt into `ingredients.csv` / `ingredients.md` / `conversions.csv`.

## Applied to the ingredient list
| Decision | Result |
|---|---|
| Edits made by hand in `ingredients.md` | Synced into the source and CSV: *Biscuits* alias "digestive" → "digestive biscuits"; *Bread (White)* drops alias "pav", adds "bread loaf". (`Pav` stays its own ingredient.) |
| `char magaz` is not an ingredient | Removed from Pumpkin Seeds and Watermelon Seeds. |
| `kakdi` is cucumber, not crab | Removed from Crab (stays on Cucumber and Kakdi (Yellow)). |
| `kesar` is saffron, not mango | Removed from Mango (Ripe) (stays on Saffron). |
| All other colliding aliases | Kept in both places. The importer asks the user when it meets one (see `anomalies.md`). |
| Kashmiri and plain red chilli are the same, whole and powder | **Kashmiri Chilli Powder → Red Chilli Powder**; **Kashmiri Red Chilli (Whole) → Dried Red Chilli**. Following the same principle (interchangeable chillies), Guntur, Sannam, Teja, Byadgi and Resham Patti are aliases of Dried Red Chilli too. Bhut Jolokia is not merged. |
| Oily toor = toor | `Toor Dal (Oily)` merged into **Toor Dal**. |
| Generic rice | Added **Rice** (generic) beside the named varieties. |
| Curd = yogurt | Already aliases of **Curd**. Greek Yogurt and Hung Curd remain separate products. |
| Milk is one thing | Full cream, toned, double toned and lactose-free are now one **Milk**. Plant milks (almond, soy, oat, coconut) stay separate. |
| Meat is meat | No fresh-vs-frozen split. `Frozen Fish` and `Frozen Paneer` removed; processed frozen products (nuggets, kebabs, patties) stay in **Frozen**. |
| Eggs do not come in trays | `tray` unit removed. Units: piece, dozen. |
| Curry leaves | Unit is **bunch ≈ 100–120 leaves** (≈ 25 g); `sprig` removed. Recipes use grams ("1 g ≈ 8–10 leaves"). |

## UI copy rules (apply to every screen, picker and filter)
- **Ingredient categories:** Dal, Grain, Spice, Dairy, Eggs, Produce, **Dry Goods**, Oil, **Meat & Fish**, Condiment, Bakery, Snacks, Beverages, Frozen, Other. (`meat_fish` / `dry_goods` are stored values; these are the labels.)
- **Diet labels, sentence case:** Vegetarian, Non-vegetarian, Vegan, Egg friendly, Jain, Gluten free, Dairy free. Cuisines keep proper-noun capitals (North Indian, South Indian, Indo-Chinese).

## Weekly plan layout (decided)
- **Four meals planned:** option B, a 2×2 block per day with the meal name under the ＋ and in each cell, no column header.
- **One to three meals planned:** option C, one column per planned meal with a column header.
- A zoomed-out week overview is not part of Build C unless requested later.

## Catalog expansion (B1a) founder decisions
- **Bird's-eye chilli is Dried Red Chilli.** `Dried Chilli (Bird's Eye)` removed; its aliases moved onto **Dried Red Chilli**.
- **Named varieties stay** (mango, date, jaggery, tea, cheese, meat cuts) as separate ingredients.
- **English only for now.** No alias in a non-Latin script; Latin transliterations (Hinglish such as "lal mirch", "doodh") stay. Source files were checked: none contained non-Latin script.

## Recipes
- **Methi Thepla** is tagged veg, vegan, dairy free. The sample recipe previously kneaded with curd, which contradicted that, so it now kneads with water.
- The remaining eleven samples are approved as drafted. Chilli powder lines now use **Red Chilli Powder**; milk lines use **Milk**.

## Shopping-list dedupe (catalog and recipe cleanup)

Found reviewing a list generated from the seeded corpus: "Garlic (Clove) 28 piece" and "Garlic 15 piece" appeared as separate lines because the catalog held both and the recipes used both. Rule applied: **the same real-world item in different forms is one ingredient** (generic canonical name kept, the removed name and its aliases become aliases, units and conversions are the union). A form that is a different product stays separate. All 202 seed recipes were audited; nothing in `recipes/` references a removed name any more (the original wording is kept in the line's `notes` where it carried meaning, for example `roasted`).

### Merged (removed name -> kept ingredient)
| Removed | Kept | Why |
|---|---|---|
| Garlic (Clove) | **Garlic** | Same item. In every recipe a garlic "piece" is a clove (3 to 8 per dish), so `piece_g` for Garlic is now **4 g** (a clove), not 40 g (a bulb). The alias "garlic bulb" is dropped so a bulb is never read as a clove |
| Coconut (Grated) | **Coconut (Fresh)** | Grated coconut is fresh coconut grated at home. The 90 g/cup conversion is kept; alias "grated coconut" kept. The recipe lines say `grated` in notes |
| Jaggery Powder | **Jaggery** | Same product, different form (160 g/cup for both) |
| Roasted Peanuts | **Peanuts** | Roasting is a cooking step; the shopper buys peanuts. Peanuts (Skinless) and Peanuts (Fried Masala) stay separate |
| Prawns (Large) | **Prawns** | Size is a note, not a different item |
| Yellow Pumpkin | **Pumpkin** | Same vegetable, same size. Red Pumpkin stays separate (different use and weight) |
| Kasuri Methi Powder | **Dried Fenugreek Leaves** | Kasuri methi is dried fenugreek leaves, crushed |
| Roasted Cumin Powder | **Cumin Powder** | The catalog already listed "roasted cumin powder" as a Cumin Powder alias; the second ingredient made it ambiguous |
| Dry Ginger Powder | **Ginger Powder** | Both carried the alias "adrak powder" |
| Mirch (Banana Pepper) | **Bhavnagri Chilli** | Same chilli (banana pepper, bajji chilli) |
| Onion (Red) | **Onion** | Onion already carried "red onion" as an alias |
| Tomato (Desi) | **Tomato** | Desi / country tomato is the ordinary Indian tomato |
| Mint Sprigs | **Mint Leaves** | Same herb, same units |
| Lemon (Sweet) | **Sweet Lime** | Mosambi |
| Cashew Pieces | **Cashew Nuts** | Whole vs broken is a price grade, not a different item |
| Black Mustard Seeds, Brown Mustard Seeds | **Mustard Seeds** | "rai" is black or brown mustard; Mustard Seeds already carried "black mustard" |

### Kept separate (deliberately)
| Pair | Reason |
|---|---|
| Garlic / Garlic Paste / Garlic Powder / Green Garlic, same for Ginger and Ginger Garlic Paste | Different products bought separately |
| Mustard Seeds / Yellow Mustard Seeds | Yellow mustard is a different seed (Bengali shorshe, pickles) |
| Onion / White Onion / Spring Onion / Shallots / Pearl Onions | Different vegetables in recipes |
| Tomato / Tomato (Roma) / Cherry Tomato / Tomato Paste | Different uses |
| Potato / Baby Potato / Sweet Potato | Different dishes |
| Lemon / Lime (Key) / Lemon (Gondhoraj) / Sweet Lime | Different fruit. There is no "Lemon Juice" ingredient (recipes use `1 piece Lemon`, `juiced`), so lemon cannot split |
| Brinjal (Round / Long / Small / Bharta) | Shapes are not interchangeable in a dish |
| Coriander Leaves / Fresh Coriander Roots / Coriander Paste / Coriander Powder / Coriander Seeds | Different products. Coriander Leaves already holds bunch, g and tbsp with conversions, so those lines merge |
| Curry Leaves / Curry Leaf Powder | Powder is a pantry product. Curry Leaves holds bunch and g and merges (see rounding below) |
| Green Chilli / Bhavnagri Chilli / Dried Red Chilli | Different heat and use |
| Poha (Thick) / Poha (Thin), Raw Rice (Ponni) / Sona Masoori / Basmati / Idli Rice | Named varieties stay (B1a decision) |
| Fenugreek Leaves / Dried Fenugreek Leaves / Fenugreek Seeds / Fenugreek Powder | Fresh leaf, dried leaf, seed and seed powder |
| Black Pepper (Whole) / Black Pepper Powder, Cardamom Powder / Green Cardamom | Whole spice vs ground, bought separately |
| Coconut (Fresh) / Coconut (Desiccated) / Dry Coconut (Copra) / Dry Coconut (Grated) | Fresh, desiccated and copra are separate products |

### Existing households after the merge
The deploy sync deletes the removed ids; `recipe_ingredients.ingredient_id` and `pantry_items.ingredient_id` are `ON DELETE SET NULL`, so affected rows keep their old text and `catalog_match = 'resolved'` but lose the id until the backfill runs. `planRecipeIngredientBackfill` / `planPantryBackfill` compare the whole row state, so such rows are replanned (recipe lines are renamed to the surviving canonical name; pantry rows record the surviving id and keep a typed qualifier like "(Clove)"); covered by `ingredientBackfill.test.ts`. Run `pnpm --filter ./api catalog:backfill` (dry run, then `--execute`) after the deploy, per environment. Until it runs, those rows are matched by name only (the unresolved-id path), which already worked. Two behaviour notes: pantry quantities of "Garlic" in `piece` were bulbs before and are cloves now, and rows the backfill renames (for example "Roasted Cumin Powder") do not gain the `roasted` / `crushed` note the seed recipes carry.

### Shopping quantities
Aggregated amounts are rounded once after merging (`api/src/domain/shoppingQuantityRounding.ts`): bunch, piece, dozen, slice, pack, packet, loaf, bottle and jar round **up** to the next 0.5 (7.28 bunch becomes 7.5, never less than the need); every other unit keeps at most 2 decimals. The remainder after pantry subtraction is rounded the same way.

### Recipes removed
`Anda Bhurji` and `Egg Bhurji` were removed as duplicates of **Anda Bhurji Masala** (the same Punjabi scrambled eggs with onion, tomato and green chilli; the kept one has the richest method and spice set). Idli, Dosa, Appam and Neer Dosa stay split by role (same title, different role). Rava Kesari / Sooji Halwa, Sprouts Chaat / Sprouted Moong Salad and Kala Chana Curry / Kadala Curry were reviewed and kept: different regional dishes or different roles.

## Legacy seed names (backfill dry-run backlog)

A dev backfill dry-run over 7,699 `recipe_ingredients` rows from older seed recipes left the names below unmatched. Each is resolved by an alias or a new ingredient in `src/*.txt` (rebuilt with `build_catalog.py`), guarded by `api/src/catalog/legacySeedAliases.test.ts`, which also runs the literal names through `planRecipeIngredientBackfill`. After deploy, `pnpm --filter ./api catalog:backfill` (dry run, then `--execute`) picks these rows up.

| Typed name (rows) | Resolution | Reason |
|---|---|---|
| `cream` (130) | alias of **Cream (Fresh)** | The everyday cooking cream. Cream (Whipping) stays its own entry |
| `lemon juice` (130) | alias of **Lemon**, plus juice conversions | Follows the "lemon cannot split" rule above: shoppers buy lemons. Lemon gains ingredient conversions ml / tsp / tbsp to g (1 lemon = 40 g yields about 30 ml, so 1 ml = 1.3333 g, 1 tsp = 6.6667 g, 1 tbsp = 20 g). "2 tbsp lemon juice" becomes `Lemon 40 g` with note `2 tbsp`, which merges with `1 piece Lemon` through `piece_g`. **Lemon Juice (Bottled)** stays a separate condiment, reached only by its own names |
| `rajma (kidney beans)` (120) | aliases `rajma` and `rajma (kidney beans)` on **Rajma (Red)** | Red kidney beans already carry "kidney beans" and "rajmah". Chitra (pinto) stays explicit |
| `green chili` (119) | aliases `green chili`, `green chilly`, `green chillies`, `green chilies` on **Green Chilli** | Spelling variants |
| `butter` (12) | alias of **Butter (Salted)** | Unmarked butter in India is salted (Amul). Unsalted and Spreadable keep their own names |
| `black peppercorns` (9), `black pepper` (3) | aliases on **Black Pepper (Whole)** | Whole is the default form (`kali mirch`, `peppercorns` already point there); Black Pepper Powder is reached by "pepper powder". Both are on the always-staple list (salt and every pepper are "to taste" staples), so shopping lists still exclude them |
| `whole wheat flour (aata)` (9) | aliases `whole wheat flour`, `whole wheat flour (aata)` on **Atta (Whole Wheat Flour)** | `aata` and `whole wheat atta` were already aliases |
| `kudampuli (gambooge)` (4) | **new ingredient** Kudampuli (Gambooge), spice_whole, 5 g per piece | Malabar tamarind (Garcinia gummi-gutta) is a different fruit from kokum (Garcinia indica) and Kerala recipes name it, so it is not an alias of Kokum. Aliases: kudampuli, gambooge, kodampuli, malabar tamarind, garcinia cambogia, fish tamarind, pot tamarind. Removed from `KNOWN_CATALOG_GAPS` in the recipe lint |
| `poha (flattened rice)` (3), `flattened rice` (1) | **new generic ingredient** Poha, dry goods, 85 g per cup | Same pattern as generic Rice: Poha (Thick) / (Thin) remain named varieties, but unspecified poha had nowhere to land. Aliases: flattened rice, poha (flattened rice), beaten rice, rice flakes, aval, avalakki, atukulu. Brown, Red, Ragi and Chira entries keep their own names |
| `pomegranate seeds` (3) | aliases `pomegranate seeds`, `pomegranate arils` on **Pomegranate** | In recipes these are the fresh arils. Dried seeds are **Pomegranate Seeds (Dried)** (anardana), reached by "dried pomegranate seeds" or "anardana" |
| `oil` (229) | **left unresolved** | Generic across Vegetable, Sunflower, Mustard, Groundnut, Coconut and others, and no default generic oil is recorded. Kept as typed (`catalog_match = unresolved`), never guessed |
| `chicken` (3), `fish` (3) | **left unresolved** | Generic across whole, curry cut, breast, thigh, mince and species. No default cut is recorded; the user picks when editing the line |

If a default cooking oil is wanted later, the obvious candidate is **Vegetable Oil** (it already carries "cooking oil" and "refined oil"); adding `oil` as its alias is a one-line catalog change.
