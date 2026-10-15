import { describe, expect, it } from 'vitest';
import { normaliseIngredient } from './normaliseIngredient.js';

const make = (overrides: Partial<{ raw: string; name: string; quantity: number | null; unit: string | null; notes: string | null }>) => ({
  raw: overrides.raw ?? overrides.name ?? 'x',
  name: overrides.name ?? 'x',
  quantity: overrides.quantity ?? null,
  unit: overrides.unit ?? null,
  notes: overrides.notes ?? null,
});

describe('normaliseIngredient — units', () => {
  it.each([
    ['gms', 'g'],
    ['gm', 'g'],
    ['Grams', 'g'],
    ['Tablespoons', 'tbsp'],
    ['pcs', 'piece'],
  ])('canonicalises unit %j to %j', (unit, expected) => {
    expect(normaliseIngredient(make({ name: 'chicken', quantity: 300, unit })).unit).toBe(expected);
  });

  it('defaults a unitless counted ingredient to piece, never cup', () => {
    const result = normaliseIngredient(make({ name: 'cloves', quantity: 6, unit: null }));
    expect(result.unit).toBe('piece');
    expect(result.quantity).toBe(6);
  });

  it('keeps unit null when there is no quantity', () => {
    const result = normaliseIngredient(make({ name: 'coriander leaves' }));
    expect(result.unit).toBeNull();
    expect(result.quantity).toBeNull();
  });

  it('passes an unrecognised model-supplied unit through lowercased rather than replacing it', () => {
    expect(normaliseIngredient(make({ name: 'mint', quantity: 1, unit: 'Handful' })).unit).toBe('handful');
  });

  it('treats a blank unit string as no unit', () => {
    expect(normaliseIngredient(make({ name: 'egg', quantity: 2, unit: '  ' })).unit).toBe('piece');
  });
});

describe('normaliseIngredient — text hygiene', () => {
  it('decodes entities and collapses whitespace in name and notes', () => {
    const result = normaliseIngredient(make({ name: 'Ginger &amp;   Garlic  paste', notes: 'finely  &quot;grated&quot;' }));
    expect(result.name).toBe('Ginger & Garlic paste');
    expect(result.notes).toBe('finely "grated"');
  });

  it('strips leading quote/inch debris and a leading "of" from the name', () => {
    expect(normaliseIngredient(make({ name: '&quot; of cinnamon', quantity: 1, unit: 'piece' })).name).toBe('cinnamon');
    expect(normaliseIngredient(make({ name: 'of cinnamon' })).name).toBe('cinnamon');
  });

  it('falls back to the cleaned raw line when the name is empty after cleaning', () => {
    expect(normaliseIngredient(make({ raw: '&quot;', name: '&quot;' })).name).toBe('"');
  });

  it('turns empty notes into null', () => {
    expect(normaliseIngredient(make({ name: 'salt', notes: '   ' })).notes).toBeNull();
  });
});

describe('normaliseIngredient — to taste', () => {
  it.each([
    ['salt or to taste', 'salt'],
    ['Salt to taste', 'salt'],
    ['salt, to taste', 'salt'],
    ['salt as per taste', 'salt'],
    ['salt as needed', 'salt'],
    ['salt as required', 'salt'],
    ['salt or as per taste', 'salt'],
    ['salt (to taste)', 'salt'],
    ['black pepper powder to taste', 'black pepper powder'],
    ['pepper as needed', 'pepper'],
  ])('strips the phrase from %j and flags salt/pepper as staple when no quantity was parsed', (name, expected) => {
    const result = normaliseIngredient(make({ name }));
    expect(result.name.toLowerCase()).toBe(expected);
    expect(result.quantity).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.isStaple).toBe(true);
  });

  it('reads the phrase from notes too and removes it when no quantity was parsed', () => {
    const result = normaliseIngredient(make({ name: 'salt', notes: 'to taste' }));
    expect(result.notes).toBeNull();
    expect(result.quantity).toBeNull();
    expect(result.isStaple).toBe(true);
  });

  it('keeps a parsed quantity and the phrase in notes, and salt stays staple', () => {
    const result = normaliseIngredient(make({ name: 'salt', quantity: 1, unit: 'tsp', notes: 'to taste' }));
    expect(result).toMatchObject({ quantity: 1, unit: 'tsp', notes: 'to taste', isStaple: true });
  });

  it('keeps quantity absent but not staple for non salt/pepper items', () => {
    const result = normaliseIngredient(make({ name: 'lemon juice to taste' }));
    expect(result.name).toBe('lemon juice');
    expect(result.quantity).toBeNull();
    expect(result.isStaple).toBe(false);
  });

  it('does not treat bell pepper as a staple', () => {
    const result = normaliseIngredient(make({ name: 'bell pepper as needed' }));
    expect(result.isStaple).toBe(false);
  });

  it('does not flag salted butter as staple', () => {
    expect(normaliseIngredient(make({ name: 'salted butter to taste' })).isStaple).toBe(false);
  });

  it('flags measured salt as staple while keeping its quantity', () => {
    const result = normaliseIngredient(make({ name: 'salt', quantity: 1, unit: 'tsp' }));
    expect(result).toMatchObject({ isStaple: true, quantity: 1, unit: 'tsp' });
  });

  it.each([
    ['salt', true],
    ['sea salt', true],
    ['rock salt', true],
    ['black salt', true],
    ['table salt', true],
    ['pepper', true],
    ['black pepper', true],
    ['white pepper', true],
    ['pepper powder', true],
    ['crushed pepper', true],
    ['Salt', true],
    ['black peppercorns', false],
    ['pepper jack cheese', false],
    ['bell pepper', false],
    ['green pepper', false],
    ['red pepper', false],
    ['salt-free seasoning', false],
    ['salted butter', false],
    ['onion', false],
  ])('measured %j (no to-taste phrase) staple=%s', (name, expected) => {
    const result = normaliseIngredient(make({ name, quantity: 2, unit: 'tsp' }));
    expect(result).toMatchObject({ isStaple: expected, quantity: 2, unit: 'tsp' });
  });

  it('keeps the original raw line cleaned', () => {
    expect(normaliseIngredient(make({ raw: '  salt   or to taste ', name: 'salt or to taste' })).raw).toBe('salt or to taste');
  });
});
