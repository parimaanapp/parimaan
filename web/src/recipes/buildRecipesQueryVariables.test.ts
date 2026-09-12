import { describe, expect, it } from 'vitest';
import { assertOwnHousehold, buildRecipesQueryVariables } from './buildRecipesQueryVariables';

describe('buildRecipesQueryVariables', () => {
  // RED test 6: the list query is always built with the resolved
  // household's own id — never a second, client-influenceable id.
  it('always includes the resolved householdId, with role omitted when no filter is chosen', () => {
    expect(buildRecipesQueryVariables('h1', null)).toEqual({ householdId: 'h1', role: undefined });
  });

  it('passes a chosen role filter through alongside the resolved householdId', () => {
    expect(buildRecipesQueryVariables('h1', 'sabzi_dal')).toEqual({ householdId: 'h1', role: 'sabzi_dal' });
  });
});

describe('assertOwnHousehold', () => {
  // RED test 6: the detail screen never renders a recipe belonging to a
  // different household, even if one were somehow returned.
  it('passes silently when the recipe belongs to the resolved household', () => {
    expect(() => assertOwnHousehold({ householdId: 'h1' }, 'h1')).not.toThrow();
  });

  it('throws when the recipe belongs to a different household', () => {
    expect(() => assertOwnHousehold({ householdId: 'h2' }, 'h1')).toThrow(/household/i);
  });
});
