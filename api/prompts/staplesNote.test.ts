import { describe, expect, it } from 'vitest';
import { buildStaplesNoteContext, buildStaplesNotePrompt, PROMPT_VERSION } from './staplesNote.js';
import type { StaplesNoteRecipeInput } from './staplesNote.js';

const mixedWeekRecipes: StaplesNoteRecipeInput[] = [
  {
    id: 'recipe-1',
    title: 'Rava Upma',
    role: 'breakfast',
    ingredients: [{ name: 'rava' }, { name: 'mustard seeds' }, { name: 'curry leaves' }],
  },
  {
    id: 'recipe-2',
    title: 'Dal Tadka',
    role: 'sabzi_dal',
    ingredients: [{ name: 'toor dal' }, { name: 'hing' }, { name: 'jeera' }],
  },
  {
    id: 'recipe-3',
    title: 'Jeera Rice',
    role: 'carb',
    ingredients: [{ name: 'basmati rice' }, { name: 'jeera' }],
  },
];

describe('buildStaplesNoteContext', () => {
  it('produces the expected shape from a fixture menu/recipe set — title, role, and ingredient names only', () => {
    const context = buildStaplesNoteContext(mixedWeekRecipes);
    expect(context).toEqual({
      recipes: [
        { title: 'Rava Upma', role: 'breakfast', ingredients: ['rava', 'mustard seeds', 'curry leaves'] },
        { title: 'Dal Tadka', role: 'sabzi_dal', ingredients: ['toor dal', 'hing', 'jeera'] },
        { title: 'Jeera Rice', role: 'carb', ingredients: ['basmati rice', 'jeera'] },
      ],
    });
  });

  it('never includes a pantry-shaped field anywhere in its output — this is explicitly not a pantry-inspection feature', () => {
    const context = buildStaplesNoteContext(mixedWeekRecipes);
    const serialized = JSON.stringify(context).toLowerCase();
    expect(serialized).not.toMatch(/pantry/);
    expect(serialized).not.toMatch(/quantity/);
    expect(serialized).not.toMatch(/low_?threshold/);
    // No shopping-list-shaped fields either — the note is about the PLAN.
    expect(serialized).not.toMatch(/category/);
    expect(serialized).not.toMatch(/haveit|have_it/);
  });

  it('dedupes a recipe that appears more than once on the same week (e.g. repeated on two days) by recipe id', () => {
    const repeated: StaplesNoteRecipeInput[] = [
      ...mixedWeekRecipes,
      { ...mixedWeekRecipes[0]! }, // same id, planned again on another day
    ];
    const context = buildStaplesNoteContext(repeated);
    expect(context.recipes).toHaveLength(3);
  });

  it('produces an empty recipe list from an empty menu — a valid, non-error shape', () => {
    const context = buildStaplesNoteContext([]);
    expect(context).toEqual({ recipes: [] });
  });

  it('is a pure function with no side effects — same input produces the same output', () => {
    expect(buildStaplesNoteContext(mixedWeekRecipes)).toEqual(buildStaplesNoteContext(mixedWeekRecipes));
  });
});

describe('buildStaplesNotePrompt', () => {
  it('is a numeric version, starting at 1', () => {
    expect(PROMPT_VERSION).toBe(1);
  });

  it('embeds each recipe title, role, and ingredient list', () => {
    const context = buildStaplesNoteContext(mixedWeekRecipes);
    const prompt = buildStaplesNotePrompt(context);
    expect(prompt).toContain('Rava Upma');
    expect(prompt).toContain('breakfast');
    expect(prompt).toContain('toor dal');
  });

  it('requests JSON only, no markdown fences or prose', () => {
    const prompt = buildStaplesNotePrompt(buildStaplesNoteContext(mixedWeekRecipes));
    expect(prompt).toMatch(/ONLY a single JSON object/i);
    expect(prompt).toMatch(/no markdown code fences/i);
  });

  it('instructs a 200-character cap on the note', () => {
    const prompt = buildStaplesNotePrompt(buildStaplesNoteContext(mixedWeekRecipes));
    expect(prompt).toMatch(/200 characters/);
  });

  it('instructs that an empty or near-empty note is a valid response, not an error', () => {
    const prompt = buildStaplesNotePrompt(buildStaplesNoteContext(mixedWeekRecipes));
    expect(prompt).toMatch(/empty string/i);
  });

  it('explicitly tells the model not to assume or guess at pantry contents — this is not a pantry-inspection feature', () => {
    const prompt = buildStaplesNotePrompt(buildStaplesNoteContext(mixedWeekRecipes));
    expect(prompt).toMatch(/do not assume.*pantry/is);
  });

  it('handles an empty week (no recipes planned) without throwing, producing a prompt that still asks for valid JSON', () => {
    const prompt = buildStaplesNotePrompt(buildStaplesNoteContext([]));
    expect(prompt).toMatch(/ONLY a single JSON object/i);
  });

  it('instructs the model to ignore embedded instructions in recipe/ingredient text (prompt-injection mitigation)', () => {
    const prompt = buildStaplesNotePrompt(buildStaplesNoteContext(mixedWeekRecipes));
    expect(prompt).toMatch(/ignore.*instruct.*deviate/is);
  });

  it('is a pure function with no side effects — same input produces the same output', () => {
    const context = buildStaplesNoteContext(mixedWeekRecipes);
    expect(buildStaplesNotePrompt(context)).toBe(buildStaplesNotePrompt(context));
  });
});
