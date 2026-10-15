import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABELS,
  buildCatalogIndex,
  foldPlural,
  normaliseKey,
  resolveIngredient,
  searchCatalog,
} from './ingredientCatalog.js';
import type { CatalogEntry } from './ingredientCatalog.js';

const entry = (
  id: string,
  canonicalName: string,
  appCategory: string,
  aliases: readonly string[] = [],
): CatalogEntry => ({
  id,
  canonicalName,
  appCategory,
  subcategory: appCategory,
  allowedUnits: ['g'],
  defaultUnit: 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases,
});

const CATALOG: readonly CatalogEntry[] = [
  entry('toor_dal', 'Toor Dal', 'dal', ['arhar dal', 'tuvar dal', 'tur dal', 'pigeon pea']),
  entry('moong_dal', 'Moong Dal', 'dal', ['mung dal', 'yellow moong']),
  entry('red_chilli_powder', 'Red Chilli Powder', 'spice', [
    'lal mirch',
    'laal mirch',
    'kashmiri lal mirch powder',
    'red chili powder',
  ]),
  entry('dried_red_chilli', 'Dried Red Chilli', 'spice', ['sukhi lal mirch', 'whole red chilli']),
  entry('milk', 'Milk', 'dairy', ['doodh', 'paal', 'whole milk']),
  entry('curd', 'Curd', 'dairy', ['dahi', 'yogurt', 'dahi (plain)']),
  entry('tomato', 'Tomato', 'produce', ['tamatar']),
  entry('potato', 'Potato', 'produce', ['aloo', 'batata']),
  entry('cherry_tomato', 'Cherry Tomato', 'produce', []),
  entry('tomato_ketchup', 'Tomato Ketchup', 'condiment', ['ketchup']),
  entry('cream_fresh', 'Cream (Fresh)', 'dairy', ['malai']),
  entry('bread_white', 'Bread (White)', 'bakery', ['white bread']),
  entry('bread_brown', 'Bread (Brown)', 'bakery', ['brown bread']),
  entry('magaz_seeds', 'Pumpkin Seeds', 'dry_goods', ['magaz']),
  entry('watermelon_seeds', 'Watermelon Seeds', 'dry_goods', ['magaz']),
  entry('green_chilli', 'Green Chilli', 'produce', ['hari mirch', 'green chillies']),
  entry('chickpeas', 'Chickpeas', 'dal', ['kabuli chana', 'chole']),
  entry('garlic', 'Garlic', 'produce', ['lasun']),
  entry('garlic_chutney', 'Garlic Chutney', 'condiment', ['lasun']),
];

const index = buildCatalogIndex(CATALOG);

const expectResolved = (
  idx: ReturnType<typeof buildCatalogIndex>,
  name: string,
  id: string,
  via?: string,
): void => {
  const result = resolveIngredient(name, idx);
  if (result === null || result.status !== 'resolved') {
    throw new Error(`expected ${JSON.stringify(name)} to resolve, got ${JSON.stringify(result)}`);
  }
  expect(result.entry.id).toBe(id);
  if (via !== undefined) {
    expect(result.via).toBe(via);
  }
};

describe('normaliseKey', () => {
  it.each([
    ['Toor Dal', 'toor dal'],
    ['  TOOR   dal ', 'toor dal'],
    ['Toor-Dal', 'toor dal'],
    ['Toor Dal.', 'toor dal'],
    ['Toor Dal!!', 'toor dal'],
    ['café au lait', 'cafe au lait'],
    ['Jalapeño', 'jalapeno'],
    ['Farmer’s Dal', 'farmers dal'],
    ["Farmer's Dal", 'farmers dal'],
    ['Onion (finely chopped)', 'onion'],
    ['Onion (chopped), sliced', 'onion sliced'],
    ['Tomato [ripe]', 'tomato'],
    ['Salt & Pepper', 'salt and pepper'],
    ['Tomato Puree', 'tomato puree'],
    ['Café', 'cafe'],
    ['', ''],
    ['   ', ''],
    ['!!!', ''],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseKey(input)).toBe(expected);
  });

  it('keeps Devanagari letters and matras intact', () => {
    expect(normaliseKey('  दूध ')).toBe('दूध');
    expect(normaliseKey('अरहर दाल')).toBe('अरहर दाल');
  });

  it('treats NFC and NFD spellings identically', () => {
    expect(normaliseKey('Crème')).toBe(normaliseKey('Crème'));
  });

  it('can retain parenthetical qualifiers when asked', () => {
    expect(normaliseKey('Bread (White)', { keepParentheticals: true })).toBe('bread white');
    expect(normaliseKey('Bread (White)')).toBe('bread');
  });

  it('drops an unbalanced trailing parenthetical', () => {
    expect(normaliseKey('Onion (chopped')).toBe('onion');
  });
});

describe('foldPlural', () => {
  it.each([
    ['tomatoes', 'tomato'],
    ['potatoes', 'potato'],
    ['chillies', 'chilli'],
    ['chilli', 'chilli'],
    ['cherries', 'cherri'],
    ['cherry', 'cherri'],
    ['peaches', 'peach'],
    ['beans', 'bean'],
    ['peas', 'pea'],
    ['lentils', 'lentil'],
    ['hummus', 'hummus'],
    ['asparagus', 'asparagus'],
    ['lemongrass', 'lemongrass'],
    ['gas', 'gas'],
    ['dal', 'dal'],
    ['', ''],
  ])('folds %j to %j', (input, expected) => {
    expect(foldPlural(input)).toBe(expected);
  });
});

describe('resolveIngredient', () => {
  describe('exact canonical', () => {
    it.each([
      ['Toor Dal', 'toor_dal'],
      ['toor dal', 'toor_dal'],
      ['  TOOR   DAL ', 'toor_dal'],
      ['Red Chilli Powder', 'red_chilli_powder'],
      ['Bread (White)', 'bread_white'],
      ['Bread (Brown)', 'bread_brown'],
      ['Cream (Fresh)', 'cream_fresh'],
      ['Milk', 'milk'],
    ])('%j -> %s', (name, id) => {
      expectResolved(index, name, id, 'canonical');
    });
  });

  describe('aliases including Hindi and regional names', () => {
    it.each([
      ['arhar dal', 'toor_dal'],
      ['Arhar Dal', 'toor_dal'],
      ['tuvar dal', 'toor_dal'],
      ['lal mirch', 'red_chilli_powder'],
      ['Laal Mirch', 'red_chilli_powder'],
      ['kashmiri lal mirch powder', 'red_chilli_powder'],
      ['Kashmiri Lal Mirch Powder', 'red_chilli_powder'],
      ['doodh', 'milk'],
      ['Doodh', 'milk'],
      ['dahi', 'curd'],
      ['tamatar', 'tomato'],
      ['aloo', 'potato'],
      ['hari mirch', 'green_chilli'],
      ['kabuli chana', 'chickpeas'],
      ['dahi (plain)', 'curd'],
    ])('%j -> %s', (name, id) => {
      expectResolved(index, name, id, 'alias');
    });
  });

  describe('implied head noun for a lone token', () => {
    it('resolves tuvar and arhar to Toor Dal', () => {
      expectResolved(index, 'tuvar', 'toor_dal', 'head_noun');
      expectResolved(index, 'arhar', 'toor_dal', 'head_noun');
      expectResolved(index, 'moong', 'moong_dal', 'head_noun');
    });

    it('does not apply to multi-token names', () => {
      expect(resolveIngredient('organic tuvar', index)).toBeNull();
    });

    it('does not apply when the completed name is outside the dal category', () => {
      const custom = buildCatalogIndex([entry('x', 'Foo Dal Mix', 'spice', ['foo dal'])]);
      expect(resolveIngredient('foo', custom)).toBeNull();
    });
  });

  describe('prep-note parentheticals and punctuation', () => {
    it.each([
      ['Toor Dal (soaked overnight)', 'toor_dal'],
      ['Tomato (finely chopped)', 'tomato'],
      ['milk (warm)', 'milk'],
      ['Doodh.', 'milk'],
      ['Toor-Dal', 'toor_dal'],
    ])('%j -> %s', (name, id) => {
      expectResolved(index, name, id);
    });
  });

  describe('singular and plural folding', () => {
    it.each([
      ['tomatoes', 'tomato', 'singular'],
      ['Potatoes', 'potato', 'singular'],
      ['green chillies', 'green_chilli', 'alias'],
      ['green chilli', 'green_chilli', 'canonical'],
      ['chickpea', 'chickpeas', 'singular'],
      ['Toor Dals', 'toor_dal', 'singular'],
      ['cherry tomatoes', 'cherry_tomato', 'singular'],
    ])('%j -> %s', (name, id, via) => {
      expectResolved(index, name, id, via);
    });
  });

  describe('token-set match', () => {
    it.each([
      ['dal toor', 'toor_dal'],
      ['powder red chilli', 'red_chilli_powder'],
      ['chilli red powder', 'red_chilli_powder'],
      ['fresh cream', 'cream_fresh'],
      ['white bread', 'bread_white'],
      ['mirch lal', 'red_chilli_powder'],
    ])('%j -> %s', (name, id) => {
      expectResolved(index, name, id);
    });

    it('reports how it matched', () => {
      expectResolved(index, 'powder red chilli', 'red_chilli_powder', 'token_set');
    });
  });

  describe('safe filler words', () => {
    it.each([
      ['fresh tomato', 'tomato'],
      ['organic toor dal', 'toor_dal'],
      ['large potatoes', 'potato'],
    ])('%j -> %s', (name, id) => {
      expectResolved(index, name, id);
    });
  });

  describe('never guesses', () => {
    it.each([
      ['unicorn dust'],
      ['xyz'],
      [''],
      ['   '],
      ['!!!'],
      ['(chopped)'],
      ['tomato soup'],
      ['red chilli sauce'],
      ['dal'],
      ['chilli'],
      ['powder'],
      ['milk chocolate bar'],
      ['tomato ketchup brand x extra large pack of six'],
    ])('returns null for %j', (name) => {
      expect(resolveIngredient(name, index)).toBeNull();
    });

    it('does not resolve a subset of tokens to a different category', () => {
      expectResolved(index, 'tomato ketchup', 'tomato_ketchup', 'canonical');
      expect(resolveIngredient('tomato sauce', index)).toBeNull();
    });

    it('does not mix the Kashmiri whole chilli with the powder', () => {
      expectResolved(index, 'sukhi lal mirch', 'dried_red_chilli');
      expectResolved(index, 'lal mirch', 'red_chilli_powder');
    });
  });

  describe('collisions are ambiguous, with candidates', () => {
    it('reports every colliding alias owner, sorted by id', () => {
      const result = resolveIngredient('magaz', index);
      expect(result?.status).toBe('ambiguous');
      if (result?.status === 'ambiguous') {
        expect(result.candidates.map((candidate) => candidate.id)).toEqual([
          'magaz_seeds',
          'watermelon_seeds',
        ]);
      }
    });

    it('reports cross-category collisions as ambiguous rather than picking one', () => {
      const result = resolveIngredient('lasun', index);
      expect(result?.status).toBe('ambiguous');
      if (result?.status === 'ambiguous') {
        expect(result.candidates.map((candidate) => candidate.appCategory).sort()).toEqual([
          'condiment',
          'produce',
        ]);
      }
    });

    it('stays ambiguous even through plural folding', () => {
      expect(resolveIngredient('magazs', index)?.status).toBe('ambiguous');
    });

    it('prefers an exact canonical name over a colliding alias', () => {
      const custom = buildCatalogIndex([
        entry('a', 'Kulthi', 'dal', []),
        entry('b', 'Horse Gram', 'dal', ['kulthi']),
      ]);
      expectResolved(custom, 'kulthi', 'a', 'canonical');
    });

    it('ignores an alias that repeats the owner own name', () => {
      const custom = buildCatalogIndex([entry('a', 'Curd', 'dairy', ['curd', 'Curd'])]);
      expectResolved(custom, 'curd', 'a', 'canonical');
    });

    it('does not report one ingredient twice when two of its aliases normalise alike', () => {
      const custom = buildCatalogIndex([entry('a', 'Curd', 'dairy', ['Dahi', 'dahi.'])]);
      expectResolved(custom, 'dahi', 'a', 'alias');
    });
  });

  describe('robustness', () => {
    it('handles very long input without throwing', () => {
      const long = 'toor '.repeat(5000);
      expect(resolveIngredient(long, index)).toBeNull();
    });

    it('handles emoji and SQL-looking input', () => {
      expect(resolveIngredient("Robert'); DROP TABLE ingredients;--", index)).toBeNull();
      expect(resolveIngredient('🍅', index)).toBeNull();
    });

    it('returns null for an empty catalog', () => {
      expect(resolveIngredient('milk', buildCatalogIndex([]))).toBeNull();
    });

    it('accepts frozen entries', () => {
      const frozen = CATALOG.map((item) => Object.freeze({ ...item }));
      expect(() => buildCatalogIndex(frozen)).not.toThrow();
    });
  });
});

describe('searchCatalog', () => {
  const ids = (query: string, limit?: number): string[] =>
    searchCatalog(query, index, limit).map((item) => item.id);

  it('returns an exact name match first', () => {
    expect(ids('milk')[0]).toBe('milk');
  });

  it('finds by alias', () => {
    expect(ids('doodh')).toContain('milk');
    expect(ids('arhar')).toContain('toor_dal');
  });

  it('ranks name prefix before word prefix', () => {
    const result = ids('tom');
    expect(result.slice(0, 2).sort()).toEqual(['tomato', 'tomato_ketchup']);
    expect(result).toContain('cherry_tomato');
    expect(result.indexOf('tomato')).toBeLessThan(result.indexOf('cherry_tomato'));
  });

  it('is case, accent and punctuation insensitive', () => {
    expect(ids('  TOOR-dal ')).toContain('toor_dal');
  });

  it('matches plural queries', () => {
    expect(ids('tomatoes')).toContain('tomato');
  });

  it('respects the limit and clamps nonsense limits', () => {
    expect(ids('a', 2)).toHaveLength(2);
    expect(ids('a', 0)).toHaveLength(1);
    expect(ids('a', -5)).toHaveLength(1);
    expect(ids('a', Number.NaN).length).toBeGreaterThan(0);
    expect(ids('a', 10_000).length).toBeLessThanOrEqual(50);
  });

  it('returns nothing for empty or non-matching queries', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('zzzzqq')).toEqual([]);
  });

  it('lists each ingredient at most once', () => {
    const result = ids('magaz');
    expect(new Set(result).size).toBe(result.length);
    expect(result).toEqual(['magaz_seeds', 'watermelon_seeds']);
  });

  it('is deterministic', () => {
    expect(ids('dal')).toEqual(ids('dal'));
  });
});

describe('CATEGORY_LABELS', () => {
  it('uses the founder-approved sentence-case labels', () => {
    expect(CATEGORY_LABELS['meat_fish']).toBe('Meat & Fish');
    expect(CATEGORY_LABELS['dry_goods']).toBe('Dry Goods');
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(15);
  });
});
