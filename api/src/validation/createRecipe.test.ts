import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRecipeArgsSchema } from './createRecipe.js';

const validInput = {
  title: 'Rajma Chawal',
  role: 'sabzi_dal',
  ingredients: [],
  steps: [],
};

describe('createRecipeArgsSchema', () => {
  it('accepts a minimal valid input (empty ingredients, empty steps)', () => {
    expect(createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: validInput }).success).toBe(
      true,
    );
  });

  it('rejects a non-UUID householdId', () => {
    expect(
      createRecipeArgsSchema.safeParse({ householdId: 'not-a-uuid', input: validInput }).success,
    ).toBe(false);
  });

  it('rejects a blank title', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, title: '' },
      }).success,
    ).toBe(false);
  });

  // The DoD gate's actual enforcement point — assert it by name.
  it('rejects a missing role — the "role assignment required" gate', () => {
    const { role, ...withoutRole } = validInput;
    void role;
    const result = createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: withoutRole });
    expect(result.success).toBe(false);
  });

  it('rejects an explicit null role — no default, absent and null both fail', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, role: null },
      }).success,
    ).toBe(false);
  });

  it('rejects an unrecognised role — closed enum, not passed through', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, role: 'dessert' },
      }).success,
    ).toBe(false);
  });

  it('normalises role case/whitespace before matching', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: { ...validInput, role: '  Sabzi_Dal  ' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input.role).toBe('sabzi_dal');
    }
  });

  it('rejects an unrecognised cuisineTier1', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, cuisineTier1: 'italian' },
      }).success,
    ).toBe(false);
  });

  it('accepts a null cuisineTier1', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, cuisineTier1: null },
      }).success,
    ).toBe(true);
  });

  it('rejects an unrecognised dietaryTags entry', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, dietaryTags: ['veg', 'carnivore'] },
      }).success,
    ).toBe(false);
  });

  it('accepts a valid dietaryTags list', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, dietaryTags: ['veg', 'gluten_free'] },
      }).success,
    ).toBe(true);
  });

  it('accepts a full ingredient list', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: {
        ...validInput,
        ingredients: [
          { name: 'Rajma beans', quantity: 2, unit: 'cup', category: 'dal', notes: 'soaked overnight', isStaple: false },
        ],
        steps: ['Soak overnight', 'Pressure cook'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a blank ingredient name', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, ingredients: [{ name: '' }] },
      }).success,
    ).toBe(false);
  });

  it('rejects a negative ingredient quantity', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, ingredients: [{ name: 'Rajma', quantity: -1 }] },
      }).success,
    ).toBe(false);
  });

  it('rejects more than 100 ingredients', () => {
    const ingredients = Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}` }));
    expect(
      createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: { ...validInput, ingredients } })
        .success,
    ).toBe(false);
  });

  it('accepts exactly 100 ingredients', () => {
    const ingredients = Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}` }));
    expect(
      createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: { ...validInput, ingredients } })
        .success,
    ).toBe(true);
  });

  it('rejects more than 100 steps', () => {
    const steps = Array.from({ length: 101 }, (_, i) => `Step ${i}`);
    expect(
      createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: { ...validInput, steps } }).success,
    ).toBe(false);
  });

  it('rejects a step over 2000 characters', () => {
    expect(
      createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: { ...validInput, steps: ['a'.repeat(2001)] },
      }).success,
    ).toBe(false);
  });

  it('rejects a negative servings', () => {
    expect(
      createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: { ...validInput, servings: 0 } })
        .success,
    ).toBe(false);
  });

  // Regression: the exact W5 §11.5.5 bug shape — a real Ferry client sends
  // an unset optional field as explicit null, not an absent key.
  it('treats explicit nulls for every optional field the same as absent', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: {
        title: 'Rajma Chawal',
        description: null,
        servings: null,
        prepMin: null,
        cookMin: null,
        cuisineTier1: null,
        cuisineTier2: null,
        dietaryTags: null,
        role: 'sabzi_dal',
        inRotation: null,
        ingredients: [],
        steps: [],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('createRecipeArgsSchema — source attribution (W7 S6, §13.2.4 D2)', () => {
  it('accepts an absent source, unchanged from every pre-W7 caller', () => {
    const result = createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: validInput });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBeUndefined();
    }
  });

  it('accepts an explicit null source, identically to absent (§11.5.5)', () => {
    const result = createRecipeArgsSchema.safeParse({ householdId: randomUUID(), input: validInput, source: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBeNull();
    }
  });

  it('accepts sourceType: url with a valid https sourceUrl', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: validInput,
      source: { sourceType: 'url', sourceUrl: 'https://example.com/recipe' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts sourceType: freeform_ai with no sourceUrl', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: validInput,
      source: { sourceType: 'freeform_ai' },
    });
    expect(result.success).toBe(true);
  });

  it.each(['curated', 'ai', 'user'])('rejects a client-claimed sourceType: %s — server-owned values', (sourceType) => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: validInput,
      source: { sourceType },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sourceType: url with no sourceUrl', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: validInput,
      source: { sourceType: 'url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sourceUrl alongside sourceType: freeform_ai', () => {
    const result = createRecipeArgsSchema.safeParse({
      householdId: randomUUID(),
      input: validInput,
      source: { sourceType: 'freeform_ai', sourceUrl: 'https://example.com/recipe' },
    });
    expect(result.success).toBe(false);
  });

  it.each(['http://example.com/recipe', 'not a url at all', 'ftp://example.com/recipe'])(
    'rejects a sourceUrl that is not a valid https URL: %s',
    (sourceUrl) => {
      const result = createRecipeArgsSchema.safeParse({
        householdId: randomUUID(),
        input: validInput,
        source: { sourceType: 'url', sourceUrl },
      });
      expect(result.success).toBe(false);
    },
  );
});
