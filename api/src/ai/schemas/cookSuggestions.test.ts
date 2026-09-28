import { describe, expect, it } from 'vitest';
import { MAX_INGREDIENTS, MAX_STEP_LENGTH, MAX_STEPS, MAX_TITLE_LENGTH } from '../../validation/recipeShared.js';
import { toRecipeDraft } from './recipeDraft.js';
import { geminiCookSuggestionSchema, geminiCookSuggestionsSchema, MAX_RAW_COOK_SUGGESTIONS } from './cookSuggestions.js';

const suggestion = (over: Record<string, unknown> = {}) => ({
  title: 'Aloo Jeera',
  description: 'Dry, quick potato side.',
  servings: 4,
  prepMin: 5,
  cookMin: 20,
  cuisineTier1: 'north_indian',
  cuisineTier2: null,
  dietaryTags: ['veg'],
  role: 'sabzi_dal',
  ingredients: [
    { name: 'potato', quantity: '4', unit: 'pcs', notes: null },
    { name: 'cumin seeds', quantity: '1', unit: 'tsp', notes: null },
  ],
  steps: ['Boil the potatoes.', 'Temper the cumin and toss.'],
  ...over,
});

describe('geminiCookSuggestionsSchema — structural checks strict, enum checks lenient (W7 D4)', () => {
  it('accepts three well-formed suggestions', () => {
    const result = geminiCookSuggestionsSchema.safeParse({ suggestions: [suggestion(), suggestion({ title: 'B' }), suggestion({ title: 'C' })] });
    expect(result.success).toBe(true);
  });

  it('accepts an empty list — "nothing to suggest" is an answer, not a parse failure', () => {
    expect(geminiCookSuggestionsSchema.safeParse({ suggestions: [] }).success).toBe(true);
  });

  it('rejects a bare array (the wrapper object is part of the contract)', () => {
    expect(geminiCookSuggestionsSchema.safeParse([suggestion()]).success).toBe(false);
  });

  it(`rejects more than ${String(MAX_RAW_COOK_SUGGESTIONS)} suggestions (a runaway response), while 4 is tolerated for the drop-and-keep-3 fallback`, () => {
    const many = (n: number) => ({ suggestions: Array.from({ length: n }, (_, i) => suggestion({ title: `T${String(i)}` })) });
    expect(geminiCookSuggestionsSchema.safeParse(many(4)).success).toBe(true);
    expect(geminiCookSuggestionsSchema.safeParse(many(MAX_RAW_COOK_SUGGESTIONS + 1)).success).toBe(false);
  });
});

describe('geminiCookSuggestionSchema — a suggestion must be a saveable recipe (createRecipe would reject the rest, §13.2.5)', () => {
  it.each([
    ['a missing title', { title: null }],
    ['an empty title', { title: '  ' }],
    ['no ingredients', { ingredients: [] }],
    ['no steps', { steps: [] }],
    ['a blank step', { steps: ['   '] }],
    ['an over-long title', { title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }],
    ['too many ingredients', { ingredients: Array.from({ length: MAX_INGREDIENTS + 1 }, () => ({ name: 'x' })) }],
    ['too many steps', { steps: Array.from({ length: MAX_STEPS + 1 }, () => 'do it') }],
    ['an over-long step', { steps: ['x'.repeat(MAX_STEP_LENGTH + 1)] }],
  ])('rejects %s', (_label, over) => {
    expect(geminiCookSuggestionSchema.safeParse(suggestion(over)).success).toBe(false);
  });

  it('accepts an unknown role, cuisine or dietary tag — toRecipeDraft degrades those with a warning', () => {
    const parsed = geminiCookSuggestionSchema.parse(suggestion({ role: 'main_course', cuisineTier1: 'thai', dietaryTags: ['keto'] }));
    const draft = toRecipeDraft(parsed);
    expect(draft.role).toBeNull();
    expect(draft.cuisineTier1).toBeNull();
    expect(draft.warnings.length).toBeGreaterThan(0);
  });

  // The spike showed models often return these as text ("4", "20 mins"); a suggestion should not die over a cook time.
  it.each([
    ['4', 4],
    ['20 mins', 20],
    ['  15 minutes', 15],
    [30, 30],
  ])('reads %j as %j for servings and times', (raw, expected) => {
    const parsed = geminiCookSuggestionSchema.parse(suggestion({ servings: raw, prepMin: raw, cookMin: raw }));
    expect([parsed.servings, parsed.prepMin, parsed.cookMin]).toEqual([expected, expected, expected]);
  });

  it.each(['a few', '', 'about half an hour', '1 hour 30', '2-3', '1.5 hours', '4.5', 4.5, -5, Number.NaN, null])(
    'degrades the unparseable or ambiguous value %j to null rather than guessing or failing the suggestion',
    (raw) => {
      const parsed = geminiCookSuggestionSchema.parse(suggestion({ servings: raw, prepMin: raw, cookMin: raw }));
      expect([parsed.servings, parsed.prepMin, parsed.cookMin]).toEqual([null, null, null]);
    },
  );

  it('drops out-of-range values: zero servings, 1000 servings, or a two-day cook time', () => {
    const parsed = geminiCookSuggestionSchema.parse(suggestion({ servings: 0, prepMin: 5000, cookMin: 1e15 }));
    expect([parsed.servings, parsed.prepMin, parsed.cookMin]).toEqual([null, null, null]);
    expect(geminiCookSuggestionSchema.parse(suggestion({ servings: 100, cookMin: 1440 })).servings).toBe(100);
  });

  it('reads an omitted servings or time as null', () => {
    const rest: Record<string, unknown> = suggestion();
    delete rest.servings;
    delete rest.prepMin;
    delete rest.cookMin;
    const parsed = geminiCookSuggestionSchema.parse(rest);
    expect([parsed.servings, parsed.prepMin, parsed.cookMin]).toEqual([null, null, null]);
  });

  it('rejects a response with no suggestions key', () => {
    expect(geminiCookSuggestionsSchema.safeParse({}).success).toBe(false);
  });

  it('maps through toRecipeDraft unchanged: same shape as the freeform parse, sourceUrl null', () => {
    const draft = toRecipeDraft(geminiCookSuggestionSchema.parse(suggestion()));
    expect(draft.title).toBe('Aloo Jeera');
    expect(draft.role).toBe('sabzi_dal');
    expect(draft.sourceUrl).toBeNull();
    expect(draft.ingredients.map((i) => i.name)).toEqual(['potato', 'cumin seeds']);
  });
});
