# Catalog anomalies and decisions needed

Generated from `ingredients.csv` plus manual review. Each item needs a **keep / merge / rename** call before sign-off.

## 1. Alias collisions — one alias points at more than one ingredient (15)
These cannot import deterministically; each needs a single owner.

| Alias | Claimed by |
|---|---|
| adrak powder | Dry Ginger Powder; Ginger Powder |
| char magaz | Pumpkin Seeds; Watermelon Seeds |
| dry garlic chutney | Garlic Chutney (Dry); Vada Pav Chutney Powder |
| kakdi | Crab; Cucumber |
| kanda | Onion; Yam (Elephant Foot) |
| kanda patha | Spring Onion; Spring Onion Greens |
| kesar | Mango (Ripe); Saffron |
| khubani | Apricot; Dried Apricots |
| kobbari | Coconut (Fresh); Dry Coconut (Copra) |
| lasun chutney | Garlic Chutney (Dry); Vada Pav Chutney Powder |
| magaz | Pumpkin Seeds; Watermelon Seeds |
| pappali | Papaya (Ripe); Raw Papaya |
| sitaphal | Custard Apple; Pumpkin |
| taadgola | Palm Fruit (Nungu); Palm Jaggery |
| whipping cream | Cream (Fresh); Cream (Whipping) |

## 2. Alias equals another ingredient’s canonical name (18)

| Alias | Listed under | But is itself the canonical name of |
|---|---|---|
| banana chips | Chips (Potato) | Banana Chips |
| bangda | Mackerel | Bangda |
| cooking chocolate | Chocolate | Cooking Chocolate |
| fish fry masala | Fish Masala | Fish Fry Masala |
| hot sauce | Red Chilli Sauce | Hot Sauce |
| kala masala | Goda Masala | Kala Masala |
| kasundi | Mustard Sauce | Kasundi |
| kulfi | Ice Cream | Kulfi |
| kulthi | Horse Gram | Kulthi |
| pav | Bread (White) | Pav |
| peanut chikki | Chikki | Peanut Chikki |
| roasted cumin powder | Cumin Powder | Roasted Cumin Powder |
| rooh afza | Rose Syrup | Rooh Afza |
| sabudana papad | Papad (Lijjat Moong) | Sabudana Papad |
| spring onion greens | Spring Onion | Spring Onion Greens |
| tikka masala (dry) | Tandoori Masala | Tikka Masala (Dry) |
| tomato paste | Tomato Puree | Tomato Paste |
| walnut halves | Walnuts | Walnut Halves |

## 3. Ingredients with no aliases yet (204)
Mostly niche/regional or global items; Build B generation adds aliases then re-reviews.

Bread Sticks, Burger Bun, Croissant, Hot Dog Bun, Kulcha (Ready), Naan (Ready), Papad (Ready Cooked), Sabudana Papad, Chicory, Lemonade Mix, Rooh Afza, Thandai Syrup, Balsamic Vinegar, Chocolate Syrup, Coconut Cream Canned, Fish Sauce, Hoisin Sauce, Hummus, Maple Syrup (Pancake), Oyster Sauce, Peri Peri Sauce, Pesto, Rice Vinegar, Salsa, Worcestershire Sauce, Harissa, Kimchi Paste, Miso Paste, Peanut Paste, Tomato Paste, Wasabi, Coconut Chutney (Packaged), Honey Ginger, Jam (Strawberry), Jelly, Karnataka Gunpowder, Raita (Ready), Shrikhand, Coconut Cream, Evaporated Milk, Flavoured Milk, Milkshake Mix, Oat Milk, Cheese Slices, Cheese Spread, Cream Cheese, Processed Cheese Spread, Kulthi, Rice Bean, Brazil Nuts, Coconut (Dried, Slices), Coconut Chips, Dates (Seedless), Dried Cranberries, Dry Dates Paste, Hazelnuts, Hemp Seeds, Macadamia, Peanut Chikki, Pecans …

## 4. Product-semantics calls (founder decision)
| Question | Current draft | Why it matters |
|---|---|---|
| Kashmiri chilli vs red chilli powder | **separate** canonicals; "lal mirch", "laal mirch powder" → Red Chilli Powder; "kashmiri lal mirch (powder)" → Kashmiri Chilli Powder | You listed all of these as one name. They are different products (colour vs heat) and your current pantry list already keeps both. Merge them or keep them apart? |
| Toor dal oily vs plain | separate (`Toor Dal`, `Toor Dal (Oily)`) | Gujarati recipes name oily toor; most households do not care. Merge? |
| Moong split/yellow/green/whole | 3 dals + whole | "Moong dal" alone defaults to yellow split. OK? |
| Urad white vs black split | separate | Used differently (idli vs dal makhani). OK? |
| Rice varieties | Basmati, Sella, Sona Masoori, Kolam, Idli, Brown… | Recipes will say "Basmati Rice" or "Rice (Boiled)"; do you want recipe-level generic "Rice"? |
| Curd vs yogurt vs Greek yogurt | Curd canonical; yogurt/yoghurt/dahi aliases; Greek separate | Greek/hung curd have different recipes use. |
| Milk types | Full Cream / Toned / Double Toned / Lactose Free separate | Recipes mostly say "milk" → defaults to Full Cream. |
| Oils | Specific oils kept separate; generic "Vegetable Oil" for recipes | Recipe import maps "oil" to Vegetable Oil; pantry keeps the real bottle. |
| Fresh vs frozen meat | Fresh in `meat_fish`; frozen packaged items in `frozen` | Your current list stores chicken under *frozen*. We are moving fresh meat to its own category. OK? |
| Garlic bulb vs clove | `Garlic` (bulb, g) and `Garlic (Clove)` (piece) | Recipes say "4 cloves"; shopping list rolls up to bulbs/grams. |
| Coconut | Fresh (piece), Grated (g/cup), Dry (Copra), Dry Grated, Tender | Five forms; conversions differ. |

## 5. Category and unit anomalies
| Item | Draft | Question |
|---|---|---|
| Eggs | new category `eggs`, units piece / dozen / tray | Needed for the "egg friendly" filter; grams intentionally absent. |
| Water | beverage, ml / l / cup / g | Recipes use it; never shown on shopping lists (staple-like). |
| Bread | piece / slice / pack / loaf / g | Slice↔piece conversion is 1:1 for now. |
| Whole spices (cloves, cardamom, cinnamon) | g / tsp / tbsp / **piece** | Recipes count them; pantry weighs them. Piece weights are estimates. |
| Curry leaves | bunch / g / sprig / tbsp | A sprig ≈ 8–10 leaves. |
| Poha, sooji, besan, vermicelli, sabudana | `dry_goods` (as your current list) | Technically grains/flours; kept where you put them. |
| New app categories | eggs, meat_fish, bakery, snacks, beverages | Today only 10 categories exist; these 5 are proposed additions. |
| Sweets (Kaju Katli, Peda, etc.) | `snacks` | Packaged sweets; no unit conversion. Drop them from the catalog? |
| Non-food rows | Removed (foil, tissue, ice) | — |

## 6. Known gaps (not yet in the draft)
- Draft holds **848** canonical ingredients, not the ~1,500 target: the remaining ~650 (regional vegetables, packaged brands, international pantry, Jain/vrat specials, baby food, supplements) are generated in Build B *after* you approve this structure, then reviewed in batches.
- Piece weights exist for ~190 produce items; the rest are filled during Build B.
- Brand names are deliberately excluded (no "Amul", "MDH"); brands appear only as aliases for the generic.
- Conversions are *typical* household values (`conversions.csv`), accurate to ~10 %; users can override per pantry item.
