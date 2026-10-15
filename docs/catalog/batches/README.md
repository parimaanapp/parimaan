# Catalog expansion review batches (Build B, slice B1a)

627 new ingredients (841 -> 1,468), split into seven batches of at most 120 rows, grouped by app category. Source of truth is `docs/catalog/src/08_*.txt` to `16_*.txt`; `ingredients.csv` is generated.

| Batch | Categories | Rows |
|---|---|---|
| 01 | Produce, Dal | 111 |
| 02 | Grain, Spice | 97 |
| 03 | Dry Goods, Oil, Dairy, Eggs | 72 |
| 04 | Meat & Fish | 75 |
| 05 | Condiment | 103 |
| 06 | Bakery, Snacks | 98 |
| 07 | Beverages, Frozen, Other | 71 |

## What to look for
1. **Wrong or invented aliases.** Regional-language names (Gujarati, Marathi, Bengali, Tamil, Telugu, Kannada, Malayalam, Konkani, North-East) were written without a native-speaker pass. Strike any alias that is not a name people actually type. Fish and regional vegetable rows need the most care.
2. **Splits that should be merges.** The founder rules are: chillies are one, one Milk, Rice generic, meat is meat, curd = yogurt, no fresh/frozen split, Kashmiri chilli = Red Chilli. Flag any new row that re-introduces a split (for example a cut, variety or fat-level that nobody plans differently).
3. **Over-specific rows.** Named mango/banana/date/jaggery/tea varieties and cut-level meat and fish rows are the likely candidates to fold into a parent.
4. **Wrong category or unit.** Check that the unit set fits (for example fresh herbs by bunch, liquids by ml, packaged items by packet) and that `piece` / `cup` gram weights look right.
5. **Aliases that belong elsewhere.** Run `python3 -I docs/catalog/analyze_catalog.py`: collisions must stay at the 12 accepted ones.
6. **Missing items.** Add anything a household would stock that is not listed.

Mark each row keep / rename / drop; edit the matching line in the relevant `src/*.txt` and rebuild with `python3 -I docs/catalog/build_catalog.py`.
