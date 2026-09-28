import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_PANTRY_ITEMS } from './cookPromptText.js';
import { isPantryTooSmall, MIN_COOKABLE_PANTRY_ITEMS, selectPromptPantryItems, type CookablePantryItem } from './cookablePantry.js';

const item = (name: string, category: string | null = 'dal', quantity = 1): CookablePantryItem => ({ name, category, quantity });

describe('isPantryTooSmall (D6)', () => {
  it('needs at least MIN_COOKABLE_PANTRY_ITEMS in-stock items that are not spices, oils or condiments', () => {
    expect(MIN_COOKABLE_PANTRY_ITEMS).toBe(3);
    expect(isPantryTooSmall([item('a'), item('b')])).toBe(true);
    expect(isPantryTooSmall([item('a'), item('b'), item('c')])).toBe(false);
  });

  it('does not count spices, oils or condiments, so five spices is too small', () => {
    const spices = ['jeera', 'haldi', 'hing', 'ajwain', 'saunf'].map((n) => item(n, 'spice'));
    expect(isPantryTooSmall(spices)).toBe(true);
    expect(isPantryTooSmall([...spices, item('ghee', 'oil'), item('ketchup', 'condiment')])).toBe(true);
  });

  it('does not count an item that has run out (quantity 0)', () => {
    expect(isPantryTooSmall([item('a'), item('b'), item('c', 'dal', 0)])).toBe(true);
  });

  it('counts an uncategorised item as food, and is case-insensitive about categories', () => {
    expect(isPantryTooSmall([item('a', null), item('b', 'Produce'), item('c', 'DAL')])).toBe(false);
    expect(isPantryTooSmall([item('a', 'SPICE'), item('b', 'Oil'), item('c', 'Condiment')])).toBe(true);
  });

  it('does not count masala or salt rows either (the same staple categories the prompt cut drops first)', () => {
    expect(isPantryTooSmall([item('a', 'masala'), item('b', 'salt'), item('c', 'dal')])).toBe(true);
  });

  it('counts an item once however many rows carry the same name', () => {
    expect(isPantryTooSmall([item('Onion'), item('onion'), item(' ONION '), item('b')])).toBe(true);
  });

  it('an empty pantry is too small', () => {
    expect(isPantryTooSmall([])).toBe(true);
  });
});

describe('selectPromptPantryItems', () => {
  it('drops items that have run out, so "in pantry" stays honest', () => {
    const selected = selectPromptPantryItems([item('a'), item('b', 'dal', 0)]);
    expect(selected.map((i) => i.name)).toEqual(['a']);
  });

  it('returns name and category only — no quantities reach the prompt or its cache key', () => {
    const [first] = selectPromptPantryItems([item('a', 'dal', 5)]);
    expect(first).toEqual({ name: 'a', category: 'dal' });
  });

  it('keeps everything when the pantry fits', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`i${String(i)}`));
    expect(selectPromptPantryItems(items)).toHaveLength(30);
  });

  it('drops staple categories (spice, masala, salt, oil) first when the pantry is over the cap, keeping every food item', () => {
    const food = Array.from({ length: 100 }, (_, i) => item(`food ${String(i).padStart(3, '0')}`, 'dry_goods'));
    const staples = Array.from({ length: 40 }, (_, i) => item(`spice ${String(i).padStart(3, '0')}`, 'spice'));
    const selected = selectPromptPantryItems([...staples, ...food]);
    expect(selected.length).toBeLessThanOrEqual(MAX_PROMPT_PANTRY_ITEMS);
    expect(selected.filter((i) => i.category === 'dry_goods')).toHaveLength(100);
    expect(selected.filter((i) => i.category === 'spice')).toHaveLength(MAX_PROMPT_PANTRY_ITEMS - 100);
  });

  it('is deterministic about which staples survive (alphabetical), whatever the input order', () => {
    const staples = Array.from({ length: 150 }, (_, i) => item(`spice ${String(i).padStart(3, '0')}`, 'spice'));
    const a = selectPromptPantryItems(staples);
    const b = selectPromptPantryItems([...staples].reverse());
    expect(a).toEqual(b);
    expect(a).toHaveLength(MAX_PROMPT_PANTRY_ITEMS);
    expect(a[0]?.name).toBe('spice 000');
  });

  it('does not mutate its input', () => {
    const input = Object.freeze([Object.freeze(item('b')), Object.freeze(item('a'))]);
    expect(() => selectPromptPantryItems(input)).not.toThrow();
  });
});
