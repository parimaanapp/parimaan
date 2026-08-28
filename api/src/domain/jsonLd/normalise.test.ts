import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonLdRecipe } from './normalise.js';

const fixturesDir = fileURLToPath(new URL('../../../test/fixtures/jsonld/', import.meta.url));
const loadFixture = (site: string): string => readFileSync(`${fixturesDir}${site}.html`, 'utf8');

/**
 * S1's own 14/20 usable-draft result (E2E_MVP_PLAN.md §13.5.12), driving
 * this table directly rather than a hand-written approximation: every site
 * where a `Recipe` node was present AND produced a title + ≥1 ingredient +
 * ≥1 step, except `bongeats` (present but both content arrays empty — its
 * own dedicated test below).
 */
const USABLE_SITES = [
  'hebbarskitchen',
  'cookwithmanali',
  'vegrecipesofindia',
  'archanaskitchen',
  'indianhealthyrecipes',
  'ministryofcurry',
  'whiskaffair',
  'spiceupthecurry',
  'vegecravings',
  'nishamadhulika',
  'rakskitchen',
  'kannammacooks',
  'maayeka',
  'cookilicious',
] as const;

/** The 5 sites S1 found with no `Recipe`-typed node anywhere on the fetched page (§13.5.12) — a real, expected outcome, not an error. */
const NO_RECIPE_NODE_SITES = ['sanjeevkapoor', 'padhuskitchen', 'mytastycurry', 'chitrasfoodbook', 'vahrehvah'] as const;

describe('parseJsonLdRecipe — S1 fixture table (E2E_MVP_PLAN.md §13.5.12)', () => {
  it.each(USABLE_SITES)('%s produces a usable draft (title + ≥1 ingredient + ≥1 step)', (site) => {
    const draft = parseJsonLdRecipe(loadFixture(site));
    expect(draft).not.toBeNull();
    expect(draft!.title.length).toBeGreaterThan(0);
    expect(draft!.ingredients.length).toBeGreaterThan(0);
    expect(draft!.steps.length).toBeGreaterThan(0);
  });

  it.each(NO_RECIPE_NODE_SITES)('%s has no Recipe-typed node and returns null, never throws', (site) => {
    expect(() => parseJsonLdRecipe(loadFixture(site))).not.toThrow();
    expect(parseJsonLdRecipe(loadFixture(site))).toBeNull();
  });

  it('bongeats — a Recipe node with well-formed metadata but empty ingredient/instruction arrays is not usable, not a partial draft', () => {
    expect(parseJsonLdRecipe(loadFixture('bongeats'))).toBeNull();
  });

  it('nishamadhulika — structurally passes but its content is placeholder/redirect text, flagged with a warning rather than shown as a clean draft', () => {
    const draft = parseJsonLdRecipe(loadFixture('nishamadhulika'));
    expect(draft).not.toBeNull();
    expect(draft!.warnings).toHaveLength(1);
    expect(draft!.warnings[0]).toMatch(/placeholder/i);
  });

  it('archanaskitchen — PT20M/PT40M durations convert to 20/40 minutes', () => {
    const draft = parseJsonLdRecipe(loadFixture('archanaskitchen'));
    expect(draft!.prepMin).toBe(20);
    expect(draft!.cookMin).toBe(40);
  });

  it('hebbarskitchen — recipeYield as ["5","5 Servings"] resolves to 5', () => {
    expect(parseJsonLdRecipe(loadFixture('hebbarskitchen'))!.servings).toBe(5);
  });

  it("kannammacooks — the malformed negative-duration value ('PT-496636H14M2S') degrades to null rather than a garbage number", () => {
    const draft = parseJsonLdRecipe(loadFixture('kannammacooks'));
    expect(draft!.prepMin).toBeNull();
    expect(draft!.cookMin).toBeNull();
  });

  it('adversarially deep HowToSection nesting does not blow the stack and still yields a usable draft', () => {
    expect(() => parseJsonLdRecipe(loadFixture('_adversarial-deep-nesting'))).not.toThrow();
    const draft = parseJsonLdRecipe(loadFixture('_adversarial-deep-nesting'));
    expect(draft).not.toBeNull();
    expect(draft!.steps).toEqual(['Final step at the bottom of an adversarial deep nest.']);
  });
});

describe('parseJsonLdRecipe — synthetic edge cases', () => {
  it('a page with no ld+json at all returns null, never throws', () => {
    expect(() => parseJsonLdRecipe('<html><body>No JSON-LD here.</body></html>')).not.toThrow();
    expect(parseJsonLdRecipe('<html><body>No JSON-LD here.</body></html>')).toBeNull();
  });
});
