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

## Recipes
- **Methi Thepla** is tagged veg, vegan, dairy free. The sample recipe previously kneaded with curd, which contradicted that, so it now kneads with water.
- The remaining eleven samples are approved as drafted. Chilli powder lines now use **Red Chilli Powder**; milk lines use **Milk**.
