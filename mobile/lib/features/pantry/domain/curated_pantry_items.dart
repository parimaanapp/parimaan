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
    'Moong Dal (Split, Yellow)',
    'Chana Dal',
    'Urad Dal (Split, Black)',
    'Masoor Dal (Red)',
    'Urad Dal (Whole)',
    'Moong (Whole)',
    'Moong Dal (Split, Green)',
    'Masoor (Whole)',
    'Lobiya (White)',
    'Rajma (Red)',
    'Urad Dal (Split, White)',
    'Rajma (Chitra)',
    'Kabuli Chana',
    'Kala Chana',
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
    'Cumin Seeds',
    'Cumin Powder',
    'Dried Red Chilli',
    'Kitchen King Masala',
    'Chicken Masala',
    'Sambar Powder',
    'Meat Masala',
    'Chole Masala',
    'Sabzi Masala',
    'Pani Puri Masala',
  ],
  'dairy': <String>[
    'Milk',
    'Cheese Slices',
    'Cheese (Processed)',
    'Paneer',
    'Cheddar',
    'Curd',
    'Flavoured Yogurt',
    'Cream (Fresh)',
    'Buttermilk',
    'Condensed Milk',
    'Flavoured Milk',
    'Butter (Unsalted)',
    'Butter (Salted)',
    'Khoya',
    'Mishti Doi',
    'Mozzarella',
  ],
  // Filled in by Claude at the founder's request — see this file's own doc
  // comment for why this one category's provenance differs from the rest.
  'dry_goods': <String>[
    'Sugar',
    'Salt',
    'Poha (Thick)',
    'Sooji',
    'Besan',
    'Vermicelli',
    'Sabudana',
    'Tea Leaves',
    'Coffee Powder',
    'Papad (Uncooked)',
    'Cashew Nuts',
    'Almonds',
    'Raisins',
    'Peanuts',
    'Dry Coconut (Copra)',
    'Jaggery',
  ],
  'grain': <String>[
    'Basmati Rice',
    'Atta (Whole Wheat Flour)',
    'Wheat (Whole)',
    'Maida',
    'Foxtail Millet',
    'Foxtail Millet Flour',
    'Basmati Rice (Aged)',
    'Kolam Rice',
    'Sona Masoori Rice',
    'Basmati Rice (Sella)',
  ],
  'oil': <String>[
    'Groundnut Oil',
    'Vegetable Oil',
    'Olive Oil',
    'Soybean Oil',
    'Sunflower Oil',
    'Mustard Oil',
    'Rice Bran Oil',
    'Safflower Oil',
    'Coconut Oil',
  ],
  'condiment': <String>[
    'Tomato Ketchup',
    'Sweet Chilli Sauce',
    'Mango Pickle',
    'Red Chilli Pickle',
    'Lime Pickle',
    'Mixed Vegetable Pickle',
    'Sweet Pickle (Ber)',
    'Sweet Lime Pickle',
    'Sweet Mango Pickle',
    'Chicken Pickle',
    'Jackfruit Pickle',
    'Radish Pickle',
    'Kimchi',
    'Garlic Pickle',
    'Green Chilli Pickle',
  ],
  'frozen': <String>[
    'Chicken Salami',
    'Chicken (Curry Cut)',
    'Chicken Thigh (Boneless)',
    'Chicken Breast (Boneless)',
    'Mutton (Leg)',
    'Mutton (Curry Cut)',
    'Fish Fillet (Boneless)',
    'Kingfish (Seer)',
    'Green Peas (Frozen)',
    'Strawberry',
    'Blueberry',
    'Frozen Fruit',
    'Chicken Nuggets',
    'Chicken Seekh Kabab',
    'Mutton Seekh Kabab',
    'French Fries',
    'Veg Nuggets',
    'Soya Chaap',
    'Veg Burger Patty',
    'Chicken Burger Patty',
    'Prawns',
  ],
  // 'produce' and 'other' are deliberately absent — no curated entries yet
  // (property 1 above). A category missing from this map falls through to
  // free-text entry exactly like one present with an empty list.
};
