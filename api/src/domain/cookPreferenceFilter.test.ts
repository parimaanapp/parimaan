import { describe, expect, it } from 'vitest';
import { allergenWarnings, findDietaryViolations, findSkipViolations, type FilterableSuggestion } from './cookPreferenceFilter.js';

const suggestion = (over: Partial<FilterableSuggestion> = {}): FilterableSuggestion => ({
  title: 'Aloo Jeera',
  dietaryTags: ['veg'],
  ingredients: [{ name: 'potato' }, { name: 'cumin seeds' }],
  ...over,
});
const withIngredients = (...names: string[]) => suggestion({ ingredients: names.map((name) => ({ name })) });

describe('findSkipViolations — the household skip list is a hard filter (D4)', () => {
  it('finds a skip term inside an ingredient name, case-insensitively and as a substring (the auto-fill ILIKE semantics)', () => {
    expect(findSkipViolations(withIngredients('Mustard Oil', 'potato'), ['mustard'])).toEqual(['mustard']);
    expect(findSkipViolations(withIngredients('spring onions'), ['ONION'])).toEqual(['ONION']);
  });

  it('also checks the title', () => {
    expect(findSkipViolations(suggestion({ title: 'Garlic Naan', ingredients: [{ name: 'flour' }] }), ['garlic'])).toEqual(['garlic']);
  });

  it('reports each violated term once, and ignores blank terms', () => {
    expect(findSkipViolations(withIngredients('onion', 'red onion'), ['onion', '  ', ''])).toEqual(['onion']);
  });

  it('finds nothing when no term matches, and when the list is empty', () => {
    expect(findSkipViolations(suggestion(), ['mustard'])).toEqual([]);
    expect(findSkipViolations(suggestion(), [])).toEqual([]);
  });

  it('pins the inherited limit: a phrase like "no raw onion" matches nothing, as in auto-fill', () => {
    expect(findSkipViolations(withIngredients('raw onion'), ['no raw onion'])).toEqual([]);
  });
});

describe('findDietaryViolations — tags AND keywords, because the model\'s self-tag is not trusted (D4)', () => {
  it('a household with no dietary tags has no violations', () => {
    expect(findDietaryViolations(withIngredients('chicken'), [])).toEqual([]);
  });

  it('requires the suggestion to carry every household tag', () => {
    const lauki = { title: 'Lauki Sabzi', ingredients: [{ name: 'lauki' }] };
    expect(findDietaryViolations(suggestion({ ...lauki, dietaryTags: ['veg'] }), ['veg', 'jain'])).toEqual(['Not tagged jain']);
    expect(findDietaryViolations(suggestion({ ...lauki, dietaryTags: ['veg', 'jain'] }), ['veg', 'jain'])).toEqual([]);
  });

  it('honours implications: vegan and jain suggestions are also veg', () => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['vegan'] }), ['veg'])).toEqual([]);
    expect(findDietaryViolations(suggestion({ dietaryTags: ['jain'] }), ['veg'])).toEqual([]);
  });

  it('normalises the model\'s tag text (case, spacing)', () => {
    expect(findDietaryViolations(suggestion({ dietaryTags: [' VEG '] }), ['veg'])).toEqual([]);
  });

  it.each(['chicken', 'Mutton curry paste', 'fish', 'prawns', 'egg', 'eggs', 'bacon'])('drops a veg household\'s suggestion containing %s even when the model tagged it veg', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['veg'], ingredients: [{ name }] }), ['veg']).length).toBeGreaterThan(0);
  });

  it('an eggetarian household accepts egg but not meat or fish', () => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['eggetarian'], ingredients: [{ name: 'eggs' }] }), ['eggetarian'])).toEqual([]);
    expect(findDietaryViolations(suggestion({ dietaryTags: ['eggetarian'], ingredients: [{ name: 'chicken' }] }), ['eggetarian']).length).toBeGreaterThan(0);
  });

  it.each(['paneer', 'ghee', 'milk', 'curd', 'butter', 'buttermilk', 'cheese', 'cream', 'honey', 'egg'])('drops a vegan household\'s suggestion containing %s', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['vegan', 'veg'], ingredients: [{ name }] }), ['vegan']).length).toBeGreaterThan(0);
  });

  it.each(['coconut milk', 'almond milk', 'peanut butter', 'soy milk', 'cocoa butter', 'eggplant', 'butternut squash'])('does not mistake the plant-based or unrelated %s for dairy or egg', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['vegan', 'veg'], ingredients: [{ name }] }), ['vegan'])).toEqual([]);
  });

  it.each(['onion', 'garlic', 'potato', 'aloo', 'ginger', 'carrot', 'radish', 'beetroot', 'sweet potato', 'garlic paste'])('drops a Jain household\'s suggestion containing %s', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['jain', 'veg'], ingredients: [{ name }] }), ['jain', 'veg']).length).toBeGreaterThan(0);
  });

  it('does not drop a Jain-compatible suggestion built from lauki, dal and besan', () => {
    expect(
      findDietaryViolations(
        suggestion({ title: 'Lauki Chana Dal', dietaryTags: ['jain', 'veg'], ingredients: [{ name: 'lauki' }, { name: 'chana dal' }, { name: 'besan' }, { name: 'hing' }] }),
        ['jain', 'veg'],
      ),
    ).toEqual([]);
  });

  it.each(['milk', 'paneer', 'curd', 'ghee'])('drops a dairy_free household\'s suggestion containing %s', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['dairy_free'], ingredients: [{ name }] }), ['dairy_free']).length).toBeGreaterThan(0);
  });

  it.each(['atta', 'maida', 'wheat flour', 'semolina', 'suji', 'bread', 'noodles'])('drops a gluten_free household\'s suggestion containing %s, but not gram or rice flour', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['gluten_free'], ingredients: [{ name }] }), ['gluten_free']).length).toBeGreaterThan(0);
    expect(findDietaryViolations(suggestion({ dietaryTags: ['gluten_free'], ingredients: [{ name: 'besan' }, { name: 'rice flour' }] }), ['gluten_free'])).toEqual([]);
  });

  it('checks the title as well as the ingredients', () => {
    expect(findDietaryViolations(suggestion({ title: 'Chicken Biryani', ingredients: [{ name: 'rice' }] }), ['veg']).length).toBeGreaterThan(0);
  });

  it('an unknown household tag is ignored rather than dropping everything', () => {
    expect(findDietaryViolations(suggestion(), ['keto'])).toEqual([]);
  });
});

describe('allergenWarnings — warn, never hide (PRD §7.1)', () => {
  it('warns, in the household\'s own words, for an allergen found in an ingredient or the title', () => {
    expect(allergenWarnings(withIngredients('peanut oil'), ['peanuts'])).toEqual(["Contains peanuts — on your household's allergen list"]);
    expect(allergenWarnings(suggestion({ title: 'Peanut Chaat' }), ['Peanuts'])).toEqual(["Contains Peanuts — on your household's allergen list"]);
  });

  it('warns once per allergen, ignores blanks, and says nothing when there is no match', () => {
    expect(allergenWarnings(withIngredients('peanuts', 'roasted peanuts'), ['peanuts', ' '])).toHaveLength(1);
    expect(allergenWarnings(suggestion(), ['peanuts'])).toEqual([]);
    expect(allergenWarnings(suggestion(), [])).toEqual([]);
  });
});

describe('findDietaryViolations — review findings (meat and fish must never slip past the veg filter)', () => {
  it.each(['coconut chicken', 'cashew chicken', 'coconut prawns', 'peanut prawn masala', 'almond chicken'])('%s is still meat: the plant-food exemption is for dairy words only', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['veg'], ingredients: [{ name }] }), ['veg']).length).toBeGreaterThan(0);
  });

  it.each(['anchovies', 'mayonnaise', 'mayo', 'turkey', 'mince', 'lard', 'duck', 'oysters', 'sardines', 'rohu', 'pomfret', 'hilsa'])('%s breaks a veg household\'s diet (ies plurals and fish/egg words included)', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['veg'], ingredients: [{ name }] }), ['veg']).length).toBeGreaterThan(0);
  });

  it.each(['gelatin', 'lassi', 'chaas', 'makhan', 'shrikhand', 'chhena', 'kefir'])('%s breaks a vegan household\'s diet', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['vegan'], ingredients: [{ name }] }), ['vegan']).length).toBeGreaterThan(0);
  });

  it.each(['pav', 'puri', 'bhatura', 'kulcha', 'dalia', 'vermicelli', 'all purpose flour', 'plain flour', 'soy sauce'])('%s breaks a gluten_free household\'s diet', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['gluten_free'], ingredients: [{ name }] }), ['gluten_free']).length).toBeGreaterThan(0);
  });

  it.each(['yam', 'suran', 'arbi', 'mushrooms', 'spring onion'])('%s breaks a Jain household\'s diet', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['jain', 'veg'], ingredients: [{ name }] }), ['jain', 'veg']).length).toBeGreaterThan(0);
  });

  it.each(['butter beans', 'cream of tartar', 'goat cheese', 'egg-free mayo', 'chicken-free broth', 'eggless cake batter', 'meatless mince'])('does not drop a good suggestion over the harmless %s', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['veg'], ingredients: [{ name }] }), ['veg'])).toEqual([]);
  });

  it.each(['besan roti', 'jowar roti', 'bajra roti', 'rice noodles', 'ragi bread', 'makki roti'])('%s is gluten-free, so a gluten_free household keeps it', (name) => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['gluten_free'], ingredients: [{ name }] }), ['gluten_free'])).toEqual([]);
  });

  it('plain roti is still wheat for a gluten_free household', () => {
    expect(findDietaryViolations(suggestion({ dietaryTags: ['gluten_free'], ingredients: [{ name: 'roti' }] }), ['gluten_free']).length).toBeGreaterThan(0);
  });
});

describe('findSkipViolations — titles match whole words, ingredient names match substrings', () => {
  it('does not drop "Boiled Egg" for the skip term "oil", nor "Steamed Idli" for "tea"', () => {
    expect(findSkipViolations(suggestion({ title: 'Boiled Egg', ingredients: [{ name: 'egg' }] }), ['oil'])).toEqual([]);
    expect(findSkipViolations(suggestion({ title: 'Steamed Idli', ingredients: [{ name: 'idli batter' }] }), ['tea'])).toEqual([]);
  });

  it('still drops a title that names the term as a word, plural or not', () => {
    expect(findSkipViolations(suggestion({ title: 'Garlic Naan', ingredients: [{ name: 'flour' }] }), ['garlic'])).toEqual(['garlic']);
    expect(findSkipViolations(suggestion({ title: 'Stuffed Peppers', ingredients: [{ name: 'capsicum' }] }), ['pepper'])).toEqual(['pepper']);
  });

  it('treats a percent sign or underscore in a term literally (unlike SQL ILIKE wildcards)', () => {
    expect(findSkipViolations(withIngredients('onion'), ['%'])).toEqual([]);
    expect(findSkipViolations(withIngredients('onion'), ['o_ion'])).toEqual([]);
  });
});

describe('allergenWarnings — household allergen words expand to the foods they cover (a safety feature must not stay silent)', () => {
  it.each([
    ['tree nuts', 'almond flour'],
    ['nuts', 'cashew'],
    ['nuts', 'peanuts'],
    ['dairy', 'paneer'],
    ['milk', 'ghee'],
    ['lactose', 'curd'],
    ['gluten', 'atta'],
    ['wheat', 'suji'],
    ['shellfish', 'prawns'],
    ['fish', 'rohu'],
    ['egg', 'eggs'],
    ['soy', 'tofu'],
    ['sesame', 'til'],
    ['peanut', 'groundnut oil'],
  ])('a household allergen of "%s" warns about %s', (allergen, ingredient) => {
    expect(allergenWarnings(withIngredients(ingredient), [allergen])).toHaveLength(1);
  });

  it.each([
    ['nuts', 'coconut'],
    ['nuts', 'nutmeg'],
    ['egg', 'eggplant'],
    ['milk', 'coconut milk'],
    ['dairy', 'peanut butter'],
  ])('does not warn that "%s" is in %s', (allergen, ingredient) => {
    expect(allergenWarnings(withIngredients(ingredient), [allergen])).toEqual([]);
  });

  it('still warns for an allergen no expansion knows, by whole word', () => {
    expect(allergenWarnings(withIngredients('kiwi fruit'), ['kiwi'])).toHaveLength(1);
  });
});
