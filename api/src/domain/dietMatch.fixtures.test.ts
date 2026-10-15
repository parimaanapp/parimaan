import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findDietaryViolations } from './cookPreferenceFilter.js';
import { DIETARY_TAG_VALUES } from './dietaryTags.js';
import { isRecipeEligible } from './dietMatch.js';

interface FixtureCase {
  household: string[];
  recipe: string[];
  eligible: boolean;
}

const fixturePath = fileURLToPath(new URL('../../../shared/fixtures/dietMatch-cases.json', import.meta.url));
const cases = (JSON.parse(readFileSync(fixturePath, 'utf8')) as { cases: FixtureCase[] }).cases;

describe('dietMatch shared fixture table (also consumed by the Dart port)', () => {
  it.each(cases.map((c) => [JSON.stringify(c.household), JSON.stringify(c.recipe), c] as const))(
    'household %s vs recipe %s',
    (_h, _r, c) => {
      expect(isRecipeEligible(c.recipe, c.household)).toBe(c.eligible);
    },
  );
});

describe('isRecipeEligible and findDietaryViolations agree over the full tag matrix (M1)', () => {
  const subsets = <T>(values: readonly T[]): T[][] =>
    Array.from({ length: 1 << values.length }, (_, mask) => values.filter((_v, i) => (mask & (1 << i)) !== 0));
  const tagSets = subsets(DIETARY_TAG_VALUES);

  it('returns the same verdict for every household x recipe tag combination', () => {
    const disagreements: string[] = [];
    for (const household of tagSets) {
      for (const recipe of tagSets) {
        const eligible = isRecipeEligible(recipe, household);
        const clean = findDietaryViolations(
          { title: 'Lauki', dietaryTags: recipe, ingredients: [{ name: 'lauki' }] },
          household,
        ).length === 0;
        if (eligible !== clean) {
          disagreements.push(`${JSON.stringify(household)} vs ${JSON.stringify(recipe)}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});
