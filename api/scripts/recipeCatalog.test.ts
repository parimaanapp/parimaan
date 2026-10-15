import { describe, expect, it } from 'vitest';
import { loadRepoCatalog, parseCatalogCsv, suggestNames } from './recipeCatalog.js';

const HEADER =
  'id,canonical_name,app_category,app_category_label,subcategory,aliases,allowed_units,default_unit,piece_g,cup_g_override,note';

const CSV = [
  HEADER,
  'salt,Salt,dry_goods,Dry Goods,salt_sugar,namak|table salt,g|kg|tsp|tbsp|cup,g,,,',
  'veg_oil,Vegetable Oil,oil,Oil,oil,oil|refined oil|sunflower oil,ml|l|tbsp|tsp|cup,ml,,,',
  'moong,"Moong Dal (Split, Yellow)",dal,Dal,dal_pulse,moong dal|mung dal,g|kg|cup,g,,200,',
  'red_chilli,Red Chilli Powder,spice,Spice,spice_ground,lal mirch|kashmiri chilli powder,g|tsp|tbsp,g,,,',
].join('\n');

describe('parseCatalogCsv', () => {
  const catalog = parseCatalogCsv(CSV);

  it('indexes ingredients by canonical name, splitting units on |', () => {
    const oil = catalog.byCanonical.get('Vegetable Oil');
    expect(oil?.appCategory).toBe('oil');
    expect(oil?.allowedUnits).toEqual(['ml', 'l', 'tbsp', 'tsp', 'cup']);
  });

  it('handles quoted fields containing commas', () => {
    expect(catalog.byCanonical.get('Moong Dal (Split, Yellow)')?.appCategory).toBe('dal');
  });

  it('indexes aliases case-insensitively', () => {
    expect(catalog.byAlias.get('kashmiri chilli powder')?.map((i) => i.canonicalName)).toEqual([
      'Red Chilli Powder',
    ]);
  });

  it('exposes aliases on each ingredient', () => {
    expect(catalog.byCanonical.get('Salt')?.aliases).toEqual(['namak', 'table salt']);
  });

  it('ignores blank lines', () => {
    expect(parseCatalogCsv(`${CSV}\n\n`).byCanonical.size).toBe(4);
  });

  it('throws on a header that is missing required columns', () => {
    expect(() => parseCatalogCsv('id,name\nsalt,Salt')).toThrow(/canonical_name/);
  });
});

describe('suggestNames', () => {
  const catalog = parseCatalogCsv(CSV);

  it('suggests the closest canonical names first', () => {
    expect(suggestNames(catalog, 'Vegetable Oils', 2)[0]).toBe('Vegetable Oil');
  });

  it('suggests by shared word', () => {
    expect(suggestNames(catalog, 'Chilli Powder', 3)).toContain('Red Chilli Powder');
  });

  it('returns at most `limit` suggestions', () => {
    expect(suggestNames(catalog, 'x', 2).length).toBeLessThanOrEqual(2);
  });
});

describe('loadRepoCatalog', () => {
  it('loads the real docs/catalog/ingredients.csv', () => {
    const catalog = loadRepoCatalog();
    expect(catalog.byCanonical.get('Cumin Seeds')?.appCategory).toBe('spice');
    expect(catalog.byCanonical.get('Salt')?.allowedUnits).toContain('tsp');
    expect(catalog.byCanonical.size).toBeGreaterThan(800);
  });
});
