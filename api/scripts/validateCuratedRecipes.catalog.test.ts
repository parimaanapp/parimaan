import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCatalogCsv } from './recipeCatalog.js';
import { validateCuratedRecipe } from './validateCuratedRecipes.js';

// B3-0 — strict catalog lint (names, units, categories, staples, step quantities)
// against a small in-memory catalog so the rules are tested independent of the
// real docs/catalog/ingredients.csv.
const catalog = parseCatalogCsv(
  [
    'id,canonical_name,app_category,app_category_label,subcategory,aliases,allowed_units,default_unit,piece_g,cup_g_override,note',
    'salt,Salt,dry_goods,Dry Goods,salt_sugar,namak|table salt,g|kg|tsp|tbsp|cup,g,,,',
    'bp,Black Pepper Powder,spice,Spice,spice_ground,pepper powder|kali mirch powder,g|tsp|tbsp,g,,,',
    'bpw,Black Pepper (Whole),spice,Spice,spice_whole,peppercorns|black peppercorns,g|tsp|tbsp|piece,g,,,',
    'wpp,White Pepper Powder,spice,Spice,spice_ground,,g|tsp|tbsp,g,,,',
    'veg_oil,Vegetable Oil,oil,Oil,oil,oil|refined oil,ml|l|tbsp|tsp|cup,ml,,,',
    'cumin,Cumin Seeds,spice,Spice,spice_whole,jeera|cumin,g|tsp|tbsp,g,,,',
    'chilli,Red Chilli Powder,spice,Spice,spice_ground,kashmiri chilli powder|lal mirch,g|tsp|tbsp,g,,,',
    'potato,Potato,produce,Produce,vegetable,aloo|batata,g|kg|piece,g,150,,',
    'toor,Toor Dal,dal,Dal,dal_pulse,arhar dal,g|kg|cup,g,,200,',
    'egg,Egg,eggs,Eggs,egg,eggs|anda,piece|dozen,piece,50,,',
  ].join('\n'),
);

const northIndianPath = join('recipes', 'north-indian', 'dal-tadka.json');

const base = {
  title: 'Dal Tadka',
  description: 'A simple everyday yellow lentil dal.',
  servings: 4,
  prepMin: 10,
  cookMin: 25,
  cuisineTier1: 'north_indian',
  dietaryTags: ['veg', 'gluten_free'],
  role: 'sabzi_dal',
  steps: ['Rinse and pressure-cook the dal until soft.', 'Temper and mix in.'],
};

const run = (ingredients: unknown[], steps?: string[]) =>
  validateCuratedRecipe(northIndianPath, { ...base, ingredients, ...(steps ? { steps } : {}) }, { catalog });

const dal = { name: 'Toor Dal', quantity: 200, unit: 'g', category: 'dal' };

describe('validateCuratedRecipe — catalog lint', () => {
  it('accepts canonical names with allowed units and matching categories', () => {
    const result = run([
      dal,
      { name: 'Potato', quantity: 3, unit: 'piece', category: 'produce' },
      { name: 'Egg', quantity: 1, unit: 'dozen', category: 'eggs' },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('rejects a name that is only an alias and says use "<canonical>"', () => {
    const result = run([dal, { name: 'Kashmiri Chilli Powder', quantity: 1, unit: 'tsp' }]);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('use "Red Chilli Powder"');
  });

  it('is case-sensitive: "Cumin seeds" is rejected with use "Cumin Seeds"', () => {
    const result = run([dal, { name: 'Cumin seeds', quantity: 1, unit: 'tsp' }]);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('use "Cumin Seeds"');
  });

  it('rejects an unknown name and lists the closest suggestions', () => {
    const result = run([dal, { name: 'Red Chilli', quantity: 1, unit: 'tsp' }]);
    expect(result.success).toBe(false);
    const message = result.errors.join(' ');
    expect(message).toContain('unknown ingredient "Red Chilli"');
    expect(message).toContain('Red Chilli Powder');
  });

  it('rejects a unit that is not allowed for the ingredient', () => {
    const result = run([{ name: 'Toor Dal', quantity: 1, unit: 'tbsp', category: 'dal' }]);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('unit "tbsp"');
    expect(result.errors.join(' ')).toContain('g, kg, cup');
  });

  it('rejects a non-positive quantity', () => {
    for (const quantity of [0, -1]) {
      const result = run([{ name: 'Toor Dal', quantity, unit: 'g' }]);
      expect(result.success).toBe(false);
    }
    const zero = run([{ name: 'Toor Dal', quantity: 0, unit: 'g' }]);
    expect(zero.errors.join(' ')).toContain('positive');
  });

  it('rejects a missing quantity on an ordinary ingredient', () => {
    const result = run([{ name: 'Potato', unit: 'piece' }]);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('quantity');
  });

  it('rejects a quantity with no unit', () => {
    const result = run([{ name: 'Toor Dal', quantity: 200 }]);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('unit');
  });

  it('allows an absent quantity only for a staple Salt or pepper', () => {
    const ok = run([dal, { name: 'Salt', isStaple: true }, { name: 'Black Pepper Powder', isStaple: true }]);
    expect(ok.errors).toEqual([]);
    const bad = run([dal, { name: 'Cumin Seeds', isStaple: true }]);
    expect(bad.success).toBe(false);
  });

  it('rejects a category that differs from the catalog app_category', () => {
    const result = run([{ name: 'Toor Dal', quantity: 200, unit: 'g', category: 'pantry' }]);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('category "pantry"');
    expect(result.errors.join(' ')).toContain('"dal"');
  });

  it('allows an omitted category', () => {
    expect(run([{ name: 'Toor Dal', quantity: 200, unit: 'g' }]).success).toBe(true);
  });

  it.each(['Salt', 'Black Pepper Powder', 'Black Pepper (Whole)', 'White Pepper Powder'])(
    'requires %s to be isStaple: true',
    (name) => {
      const result = run([dal, { name, quantity: 1, unit: 'tsp' }]);
      expect(result.success).toBe(false);
      expect(result.errors.join(' ')).toContain('isStaple');
      const fixed = run([dal, { name, quantity: 1, unit: 'tsp', isStaple: true }]);
      expect(fixed.errors).toEqual([]);
    },
  );

  it('does not force ordinary spices to be staples', () => {
    expect(run([dal, { name: 'Cumin Seeds', quantity: 1, unit: 'tsp' }]).success).toBe(true);
  });

  it('rejects HTML entities in steps', () => {
    const result = run([dal], ['Add salt &amp; pepper.']);
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('HTML entit');
  });

  it('warns (does not fail) when a step states a different unit than the ingredient list', () => {
    const result = run([dal], ['Wash 1 cup toor dal and pressure cook until soft.']);
    expect(result.success).toBe(true);
    expect(result.warnings.join(' ')).toContain('Toor Dal');
    expect(result.warnings.join(' ')).toContain('cup');
  });

  it('does not warn when step units match the ingredient list', () => {
    const result = run([dal], ['Wash 200 g toor dal and pressure cook until soft.']);
    expect(result.warnings).toEqual([]);
  });

  it('matches step mentions through catalog aliases (oil -> Vegetable Oil)', () => {
    const result = run([dal, { name: 'Vegetable Oil', quantity: 3, unit: 'tbsp' }], ['Heat 1 tsp oil in a pan.']);
    expect(result.warnings.join(' ')).toContain('Vegetable Oil');
  });

  it('demotes known catalog gaps to warnings instead of errors', () => {
    const result = run([dal, { name: 'Boondi', quantity: 0.5, unit: 'cup' }]);
    expect(result.success).toBe(true);
    expect(result.warnings.join(' ')).toContain('catalog gap');
  });

  it('skips catalog checks when catalog is null (diet-lint unit seam)', () => {
    const result = validateCuratedRecipe(
      northIndianPath,
      { ...base, ingredients: [{ name: 'whatever', quantity: 1, unit: 'zzz' }] },
      { catalog: null },
    );
    expect(result.success).toBe(true);
  });

  it('reports catalog errors together with diet-tag errors', () => {
    const result = validateCuratedRecipe(
      northIndianPath,
      { ...base, dietaryTags: ['gluten_free'], ingredients: [{ name: 'Nope', quantity: 1, unit: 'g' }] },
      { catalog },
    );
    expect(result.errors.join(' ')).toContain('unknown ingredient');
    expect(result.errors.join(' ')).toContain('style tag');
  });
});
