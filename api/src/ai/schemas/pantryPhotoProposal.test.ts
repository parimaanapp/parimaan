import { describe, expect, it } from 'vitest';
import { KNOWN_PANTRY_CATEGORIES } from '../../domain/pantryCategories.js';
import { MAX_NAME_LENGTH } from '../../validation/addPantryItem.js';
import {
  buildPantryPhotoPrompt,
  geminiPantryPhotoSchema,
  MAX_PROPOSED_ITEMS,
  PHOTO_UNITS,
  toPantryPhotoProposals,
} from './pantryPhotoProposal.js';

const item = (over: Record<string, unknown> = {}) => ({
  name: 'Toor Dal',
  quantity: 1,
  unit: 'jar',
  category: 'dal',
  confidence: 'medium',
  ...over,
});
const convert = (raw: unknown[]) => toPantryPhotoProposals(geminiPantryPhotoSchema.parse(raw));

describe('geminiPantryPhotoSchema (structural only — enum and bounds degradation is toPantryPhotoProposals\'s job)', () => {
  it('accepts a well-formed array, including null quantity/unit and an empty array', () => {
    expect(geminiPantryPhotoSchema.safeParse([item(), item({ quantity: null, unit: null })]).success).toBe(true);
    expect(geminiPantryPhotoSchema.safeParse([]).success).toBe(true);
  });

  it('rejects a non-array and an item with no name', () => {
    expect(geminiPantryPhotoSchema.safeParse({ items: [] }).success).toBe(false);
    expect(geminiPantryPhotoSchema.safeParse([item({ name: '' })]).success).toBe(false);
  });

  it('does not reject an unrecognised category, unit, or confidence — those degrade with a warning, never a reinforcement retry', () => {
    expect(geminiPantryPhotoSchema.safeParse([item({ category: 'snack', unit: 'crate', confidence: 'certain' })]).success).toBe(true);
  });

  it('rejects a runaway array far beyond the cap (a defensive structural bound, not the product cap)', () => {
    expect(geminiPantryPhotoSchema.safeParse(Array.from({ length: MAX_PROPOSED_ITEMS * 2 + 1 }, () => item())).success).toBe(false);
  });
});

describe('toPantryPhotoProposals — clean pass-through', () => {
  it('passes a clean item through unchanged with no warnings', () => {
    const result = convert([item()]);
    expect(result.items).toEqual([
      { name: 'Toor Dal', quantity: 1, unit: 'jar', category: 'dal', confidence: 'medium', warnings: [] },
    ]);
    expect(result.droppedCount).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe('toPantryPhotoProposals — generic placeholders and non-food are dropped (D12; real names from W19/W20-S1 output)', () => {
  it.each(['Spice Mix Jar', 'Spice Jar', 'Storage Jar', 'Oil or Sauce', 'Sauce', 'Spice Powder', 'Spices', 'Snack Packet'])(
    'drops the generic placeholder %s',
    (name) => {
      const result = convert([item({ name })]);
      expect(result.items).toEqual([]);
      expect(result.droppedCount).toBe(1);
    },
  );

  it.each(['Freshwrapp Aluminium Foil', 'Vitamin C Tablets', 'Dishwash Soap'])('drops the non-food item %s', (name) => {
    expect(convert([item({ name })]).items).toEqual([]);
  });

  it.each(['Chili Powder', 'Tata Sampann Spices', 'Mixed Dal', 'Mixed Namkeen', 'Carton Milk', 'Kissan Cloves'])(
    'keeps the real item %s — the filter targets placeholders, not merely words like Spice or Mixed',
    (name) => {
      expect(convert([item({ name })]).items).toHaveLength(1);
    },
  );
});

describe('toPantryPhotoProposals — duplicates', () => {
  it('collapses a case-insensitive duplicate name, summing same-unit quantities', () => {
    const result = convert([item({ name: 'Toor Dal', quantity: 1 }), item({ name: 'toor dal', quantity: 2 })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Toor Dal', quantity: 3, unit: 'jar' });
  });

  it('keeps the first when duplicate units differ, rather than summing across units', () => {
    const result = convert([item({ quantity: 1, unit: 'jar' }), item({ quantity: 500, unit: 'g' })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ quantity: 1, unit: 'jar' });
  });
});

describe('toPantryPhotoProposals — enum leniency degrades one field with a warning', () => {
  it('maps an unknown category to other, with a warning', () => {
    const [p] = convert([item({ category: 'snack' })]).items;
    expect(p?.category).toBe('other');
    expect(p?.warnings).toEqual([expect.stringContaining('snack')]);
  });

  it('canonicalizes category and unit case', () => {
    const [p] = convert([item({ category: 'Dal', unit: 'KG' })]).items;
    expect(p).toMatchObject({ category: 'dal', unit: 'kg', warnings: [] });
  });

  it('nulls an unknown unit with a warning but keeps the quantity', () => {
    const [p] = convert([item({ unit: 'crate', quantity: 2 })]).items;
    expect(p).toMatchObject({ unit: null, quantity: 2 });
    expect(p?.warnings).toEqual([expect.stringContaining('crate')]);
  });

  it('nulls a unit that is valid app vocabulary but not a photo unit (a photo cannot show a teaspoon)', () => {
    expect(convert([item({ unit: 'tsp' })]).items[0]?.unit).toBeNull();
  });

  it('normalizes confidence case, and treats a missing or unknown confidence as low (unticked by default, D12)', () => {
    expect(convert([item({ confidence: 'HIGH' })]).items[0]?.confidence).toBe('high');
    expect(convert([item({ confidence: 'certain' })]).items[0]?.confidence).toBe('low');
    expect(convert([item({ confidence: undefined })]).items[0]?.confidence).toBe('low');
  });
});

describe('toPantryPhotoProposals — quantity', () => {
  it('accepts a positive number and a numeric string', () => {
    expect(convert([item({ quantity: 2 })]).items[0]?.quantity).toBe(2);
    expect(convert([item({ quantity: '3' })]).items[0]?.quantity).toBe(3);
  });

  it.each([0, -1, 'a few', null, undefined, 1e9])('turns %s into null rather than proposing an unsaveable or meaningless amount', (quantity) => {
    expect(convert([item({ quantity })]).items[0]?.quantity).toBeNull();
  });
});

describe('toPantryPhotoProposals — name hygiene and the item cap', () => {
  it('strips control characters, collapses whitespace, and truncates to the saveable name limit', () => {
    const [p] = convert([item({ name: `  Toor\u0000  \n Dal  ` })]).items;
    expect(p?.name).toBe('Toor Dal');
    const long = convert([item({ name: 'x'.repeat(MAX_NAME_LENGTH + 50) })]).items[0];
    expect(long?.name).toHaveLength(MAX_NAME_LENGTH);
  });

  it('drops an item whose name is empty after cleaning', () => {
    expect(convert([item({ name: '\u0000 \u0001' })]).items).toEqual([]);
  });

  it('caps at MAX_PROPOSED_ITEMS after filtering, reporting truncation', () => {
    const raw = Array.from({ length: MAX_PROPOSED_ITEMS + 5 }, (_, i) => item({ name: `Item ${String(i)}` }));
    const result = convert(raw);
    expect(result.items).toHaveLength(MAX_PROPOSED_ITEMS);
    expect(result.truncated).toBe(true);
  });
});

describe('buildPantryPhotoPrompt — vocabulary comes from the app, not a copy that can drift', () => {
  const prompt = buildPantryPhotoPrompt();

  it('lists every app category and every photo unit', () => {
    for (const category of KNOWN_PANTRY_CATEGORIES) expect(prompt).toContain(category);
    for (const unit of PHOTO_UNITS) expect(prompt).toContain(unit);
  });

  it('does not offer categories the app lacks (W19\'s spike prompt invented these)', () => {
    expect(prompt).not.toMatch(/\b(beverage|staple)\b/);
    expect(prompt).not.toMatch(/"snack"/);
  });

  it('states the item cap, the food-only rule, the visible-contents rule, and the no-placeholder rule', () => {
    expect(prompt).toContain(String(MAX_PROPOSED_ITEMS));
    expect(prompt).toMatch(/not food or drink/i);
    expect(prompt).toMatch(/visible contents/i);
    expect(prompt).toMatch(/placeholder/i);
  });
});
