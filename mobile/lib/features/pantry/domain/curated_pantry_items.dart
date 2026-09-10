/// A shortcut for the common case, not a pantry ontology (E2E_MVP_PLAN.md
/// §20.2.5, D5, Q21) — the multi-select picker's per-category item list,
/// hardcoded in the client because a table/resolver for this would be
/// architecture in search of a problem no one has (Q21). Keyed by the
/// existing [knownPantryCategories] values (`pantry_category.dart`), so the
/// picker needs no category vocabulary of its own.
///
/// **Order within a list is the product decision, not the alphabet.** Every
/// list below is the founder's own hand-ordering — most-likely-first for a
/// real Indian kitchen — and is never sorted or alphabetised at render time;
/// doing so would silently discard the one piece of product judgment this
/// file exists to carry. `dal`'s own order (Toor Dal first) is the worked
/// example the founder gave when this slice was scoped (E2E_MVP_PLAN.md
/// §20.5.4), and every other category follows the identical convention.
///
/// **`dryGoods` is the one category filled in by Claude's own judgment, at
/// the founder's explicit request, rather than hand-ordered by the founder
/// like every other category here** — flagged so a future reader does not
/// mistake its provenance for the others'. If it reads wrong to a real
/// kitchen, treat it exactly like every other entry in this file: wrong at
/// first, meant to be edited here directly (property 2 below), never a
/// reason to block on a "correct" author before shipping.
///
/// Three properties every list here is *allowed* to have — carried over
/// verbatim from `pantryUnits.ts`'s identical doc, so nobody "fixes" them
/// later:
///
/// 1. **Incomplete.** `produce` and `other` have no entries at all yet — a
///    category with zero curated items is not a bug; it falls straight
///    through to free-text entry with no empty-state dead end (D5, D6).
/// 2. **Wrong at first.** This is a guess a real kitchen should correct,
///    not a taxonomy to defend.
/// 3. **Free of quantities and units.** Every entry here is a **name
///    only** — quantity and unit come from the user through the picker's
///    own stepper. Pre-filling a plausible quantity would be inventing
///    data about someone's kitchen, and would make a wrong default
///    stickier than an empty one (D5's third property).
const Map<String, List<String>> curatedPantryItems = <String, List<String>>{
  'dal': <String>[
    'Toor Dal',
    'Navratan Dal',
    'Moong Dal (split)',
    'Chana Dal',
    'Urad Dal (split)',
    'Masoor Dal (Red)',
    'Urad Dal (whole)',
    'Moong Dal (whole)',
    'Moong Dal (chilka)',
    'Masoor Dal (black)',
    'White Lobiya',
    'Red Rajma (kidney bean)',
    'Urad Dal (white)',
    'Chitra Rajma (pinto bean)',
    'Kabuli Chana (Chole)',
    'Kale Chane',
  ],
  'spice': <String>[
    'Turmeric Powder',
    'Star Anise',
    'Garam Masala',
    'Coriander Powder',
    'Biryani Masala',
    'Red Chilli Powder',
    'Maggi Magic Masala',
    'Chaat Masala',
    'Cumin seeds',
    'Cumin powder',
    'Kashmiri Chilli Powder',
    'Kitchen King Masala',
    'Chicken Masala',
    'Sambar Masala',
    'Meat Masala',
    'Chole Masala',
    'Sabzi Masala',
    'Pani Puri Masala',
  ],
  'dairy': <String>[
    'Whole Milk (full cream milk)',
    'Skimmed Milk',
    'Toned Milk',
    'Cheese (slices)',
    'Cheese (cubes)',
    'Paneer (block)',
    'Cheese (block)',
    'Curd',
    'Yogurt (flavoured)',
    'Fresh Cream',
    'Spiced Salted Buttermilk',
    'Condensed Milk',
    'Lactose-free Milk',
    'Flavoured Milk',
    'Unsalted Butter',
    'Salted Butter',
    'Khoa',
    'Mishti Doi',
    'Cheese (diced)',
  ],
  // Filled in by Claude at the founder's request — see this file's own doc
  // comment for why this one category's provenance differs from the rest.
  'dry_goods': <String>[
    'Sugar',
    'Salt',
    'Poha (Flattened Rice)',
    'Sooji (Semolina/Rava)',
    'Besan (Gram Flour)',
    'Vermicelli (Semiya)',
    'Sabudana (Tapioca Pearls)',
    'Tea Leaves',
    'Coffee Powder',
    'Papad',
    'Cashews',
    'Almonds',
    'Raisins',
    'Peanuts',
    'Dry Coconut (Copra)',
    'Jaggery',
  ],
  'grain': <String>[
    'Rice (medium-grain basmati)',
    'Aata (Whole Wheat Flour)',
    'Wheat',
    'Maida',
    'Millet',
    'Millet Flour',
    'Refined Flour',
    'Rice (long-grain basmati)',
    'Rice (kolam)',
    'Rice (sonamasuri)',
    'Rice (sella basmati)',
  ],
  'oil': <String>[
    'Peanut Oil (groundnut oil)',
    'Vegetable Oil',
    'Olive Oil',
    'Soyabean Oil',
    'Sunflower Oil',
    'Mustard Oil',
    'Rice Bran Oil',
    'Safflower Oil',
    'Coconut Oil',
  ],
  'condiment': <String>[
    'Tomato Ketchup',
    'Sweet and Spicy Chilli Ketchup',
    'Mango Pickle (Mango Thokku)',
    'Chilli Pickle (Chilli Thokku)',
    'Lime Pickle (Lime Thokku)',
    'Mix Veg Pickle (Mix Veg Thokku)',
    'Meetha Ber Pickle',
    'Sweet Lime Pickle',
    'Sweet Mango Pickle',
    'Peri Peri Chicken Pickle',
    'Jackfruit Pickle',
    'Radish Kimchi',
    'Kimchi',
    'Garlic Pickle',
    'Green Chilli Pickle (Green Chilli Thokku)',
  ],
  'frozen': <String>[
    'Chicken Salami',
    'Chicken Curry Cut',
    'Chicken Thighs (boneless)',
    'Chicken Breast (boneless)',
    'Mutton (bone-in)',
    'Mutton (curry cut)',
    'Fish (boneless fillet)',
    'Fish (bone-in)',
    'Green Peas',
    'Strawberries',
    'Blueberries',
    'Mix Berries',
    'Chicken Nuggets',
    'Chicken Seekh Kabab',
    'Mutton Seekh Kabab',
    'French Fries',
    'Chicken French Fries',
    'Potato Nuggets',
    'Soya Chaap',
    'Veg Burger Patty',
    'Chicken Burger Patty',
    'Sabudana Wada (Sabudana Tikki)',
    'Prawns',
  ],
  // 'produce' and 'other' are deliberately absent — no curated entries yet
  // (property 1 above). A category missing from this map falls through to
  // free-text entry exactly like one present with an empty list.
};
