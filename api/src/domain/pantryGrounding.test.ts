import { describe, expect, it } from 'vitest';
import { buildCookFromPantryPrompt } from '../../prompts/cookFromPantry.js';
import { normalizeForPrompt, PROMPT_LIMITS } from './cookPromptText.js';
import {
  groundSuggestion,
  isGroundedEnough,
  matchIngredientToPantry,
  MAX_MISSING_INGREDIENTS,
  MIN_PANTRY_MATCHES,
  type PantryItemRef,
} from './pantryGrounding.js';

const pantry = (...names: string[]): PantryItemRef[] => names.map((name) => ({ name, category: null }));
const match = (ingredient: string, items: PantryItemRef[]) => matchIngredientToPantry(ingredient, items);

describe('the grounding thresholds are the ones the prompt promises the model', () => {
  it('reads them from PROMPT_LIMITS, and the rendered prompt states the same numbers', () => {
    expect(MAX_MISSING_INGREDIENTS).toBe(PROMPT_LIMITS.missing);
    expect(MIN_PANTRY_MATCHES).toBe(PROMPT_LIMITS.minPantryItems);
    const prompt = buildCookFromPantryPrompt({ pantry: ['a'], vibe: null, dietaryTags: [], skipIngredients: [], allergens: [], cuisineTier1: [], cuisineTier2Weights: {} });
    expect(prompt).toContain(`at most ${String(MAX_MISSING_INGREDIENTS)} ingredients`);
    expect(prompt).toContain(`at least ${String(MIN_PANTRY_MATCHES)} items`);
  });
});

describe('matchIngredientToPantry — exact and normalised matches', () => {
  it('matches a name regardless of case, spacing and a trailing plural', () => {
    expect(match('Toor Dal', pantry('toor dal'))).toEqual({ status: 'in_pantry', pantryItemName: 'toor dal' });
    expect(match('  tomatoes ', pantry('Tomato'))).toEqual({ status: 'in_pantry', pantryItemName: 'Tomato' });
    expect(match('potatoes', pantry('Potato'))).toEqual({ status: 'in_pantry', pantryItemName: 'Potato' });
    expect(match('green chillies', pantry('Green Chilli'))).toEqual({ status: 'in_pantry', pantryItemName: 'Green Chilli' });
  });

  it('ignores a parenthetical or a trailing preparation note', () => {
    expect(match('Onion (finely chopped)', pantry('Onion')).status).toBe('in_pantry');
    expect(match('ginger, grated', pantry('Ginger')).status).toBe('in_pantry');
  });

  it('reports the pantry row\'s own name, never the model\'s wording (D3)', () => {
    expect(match('potato', pantry('Aloo')).pantryItemName).toBe('Aloo');
  });
});

describe('matchIngredientToPantry — Hindi/regional/English aliases (seeded from the S1 spike misses)', () => {
  it.each([
    ['cumin seeds', 'Jeera'],
    ['jeera', 'Cumin Seeds'],
    ['besan', 'Gram Flour'],
    ['gram flour', 'Besan'],
    ['chickpea flour', 'Besan'],
    ['wheat flour', 'Atta'],
    ['whole wheat flour', 'Atta'],
    ['coriander powder', 'Dhania Powder'],
    ['aloo', 'Potato'],
    ['tomato', 'Tamatar'],
    ['green chili', 'Green Chilli'],
    ['yogurt', 'Curd'],
    ['tur dal', 'Toor Dal'],
    ['ajwain', 'Carom Seeds'],
    ['lauki', 'Bottle Gourd'],
    ['suji', 'Rava'],
  ])('%s matches a pantry item named %s', (ingredient, pantryName) => {
    expect(match(ingredient, pantry(pantryName))).toEqual({ status: 'in_pantry', pantryItemName: pantryName });
  });

  it('treats "coriander" (leaves) and "coriander powder" as different things', () => {
    expect(match('coriander powder', pantry('Coriander Leaves')).status).toBe('missing');
    expect(match('coriander leaves', pantry('Dhania Powder')).status).toBe('missing');
    expect(match('coriander', pantry('Dhania')).status).toBe('in_pantry');
  });
});

describe('matchIngredientToPantry — generic heads (the S1 spike\'s "oil" and "rice" misses)', () => {
  it('matches a generic "oil" or "cooking oil" against any oil in the pantry, by category or name', () => {
    expect(match('oil', pantry('Mustard Oil')).pantryItemName).toBe('Mustard Oil');
    expect(match('cooking oil', [{ name: 'Fortune Sunlite', category: 'oil' }]).pantryItemName).toBe('Fortune Sunlite');
    expect(match('oil for frying', pantry('Coconut Oil')).status).toBe('in_pantry');
  });

  it('matches a generic "rice" against any kind of rice, but not rice flour', () => {
    expect(match('rice', pantry('Basmati Rice')).status).toBe('in_pantry');
    expect(match('rice', pantry('Rice Flour')).status).toBe('missing');
  });

  it('does not treat a specific oil as satisfied by a different specific oil', () => {
    expect(match('mustard oil', pantry('Coconut Oil')).status).toBe('missing');
  });

  it('a generic oil is missing when the pantry has no oil at all', () => {
    expect(match('oil', pantry('Toor Dal', 'Potato')).status).toBe('missing');
  });
});

describe('matchIngredientToPantry — deliberate non-matches (each is a pinned decision, D3)', () => {
  it.each([
    ['onion', 'Onion Powder'],
    ['onion powder', 'Onion'],
    ['dal', 'Toor Dal'],
    ['toor dal', 'Urad Dal'],
    ['moong dal', 'Masoor Dal'],
    ['chilli powder', 'Chilli Flakes'],
    ['green chilli', 'Green Chilli Sauce'],
    ['coconut milk', 'Milk'],
    ['peanut butter', 'Butter'],
    ['mustard oil', 'Mustard Seeds'],
  ])('%s is NOT satisfied by %s (a false Have is the harmful direction)', (ingredient, pantryName) => {
    expect(match(ingredient, pantry(pantryName)).status).toBe('missing');
  });
});

describe('matchIngredientToPantry — assumed items and results', () => {
  it('water and salt are assumed, whatever the pantry holds, and carry no pantry name', () => {
    expect(match('Water', [])).toEqual({ status: 'assumed', pantryItemName: null });
    expect(match('salt', pantry('Rock Salt'))).toEqual({ status: 'assumed', pantryItemName: null });
    expect(match('salt to taste', [])).toEqual({ status: 'assumed', pantryItemName: null });
  });

  it('is missing, with no pantry name, when nothing matches', () => {
    expect(match('curry leaves', pantry('Potato'))).toEqual({ status: 'missing', pantryItemName: null });
  });

  it('is missing for an empty or blank ingredient name rather than matching everything', () => {
    expect(match('', pantry('Potato')).status).toBe('missing');
    expect(match('   ', pantry('Potato')).status).toBe('missing');
  });

  it('prefers an exact match over an alias or fuzzy one, and is stable regardless of pantry order', () => {
    const items = pantry('Jeera', 'Cumin Seeds', 'Cumin');
    const forward = match('cumin', items);
    const backward = match('cumin', [...items].reverse());
    expect(forward).toEqual(backward);
    expect(forward.pantryItemName).toBe('Cumin');
  });

  it('does not mutate the pantry it is given', () => {
    const items = Object.freeze(pantry('B', 'A').map((i) => Object.freeze(i)));
    expect(() => match('a', items as PantryItemRef[])).not.toThrow();
  });
});

describe('groundSuggestion', () => {
  const items = pantry('Potato', 'Jeera', 'Tomato', 'Mustard Oil');

  it('returns exactly one match per ingredient, in order', () => {
    const names = ['potatoes', 'cumin seeds', 'coriander', 'salt', 'oil'];
    const result = groundSuggestion(names, items);
    expect(result.ingredientMatches.map((m) => m.status)).toEqual(['in_pantry', 'in_pantry', 'missing', 'assumed', 'in_pantry']);
    expect(result.ingredientMatches).toHaveLength(names.length);
  });

  it('lists distinct pantry-row names as Have, and the model\'s own wording as Missing', () => {
    const result = groundSuggestion(['potato', 'aloo', 'jeera', 'curry leaves', 'coriander'], items);
    expect(result.have).toEqual(['Potato', 'Jeera']);
    expect(result.missing).toEqual(['curry leaves', 'coriander']);
  });

  it('never lists an assumed ingredient as Have or Missing', () => {
    const result = groundSuggestion(['water', 'salt'], []);
    expect(result.have).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

describe('isGroundedEnough (D3\'s drop rule)', () => {
  it.each([
    [2, 4, true],
    [5, 0, true],
    [1, 0, false],
    [0, 0, false],
    [6, 5, false],
    [2, 5, false],
  ])('have=%i missing=%i → %s', (have, missing, expected) => {
    expect(
      isGroundedEnough({
        have: Array.from({ length: have }, (_, i) => `h${String(i)}`),
        missing: Array.from({ length: missing }, (_, i) => `m${String(i)}`),
      }),
    ).toBe(expected);
  });
});

describe('false Haves found in review — each pinned as a Missing (a false Have is the harmful direction)', () => {
  it.each([
    ['red chilli powder', 'Green Chilli Powder'],
    ['green chilli powder', 'Red Chilli Powder'],
    ['unsalted butter', 'Salted Butter'],
    ['pea', 'Pear'],
    ['peas', 'Pear'],
    ['moong dal', 'Moong Dal Dry'],
    ['dry red chilli', 'Red Chilli'],
    ['kashmiri chilli powder', 'Chilli Powder'],
    ['fenugreek leaves', 'Kasuri Methi'],
    ['methi', 'Methi Dana'],
    ['moong dal (whole)', 'Moong Dal'],
    ['oil', 'Castor Oil'],
    ['cooking oil', 'Hair Oil'],
    ['rice', 'Puffed Rice'],
    ['rice', 'Flattened Rice'],
  ])('%s is NOT satisfied by %s', (ingredient, pantryName) => {
    expect(match(ingredient, pantry(pantryName)).status).toBe('missing');
  });

  it.each([
    ['red chilli powder', 'Chilli Powder'],
    ['chilli powder', 'Red Chilli Powder'],
    ['kashmiri chilli powder', 'Kashmiri Chilli Powder'],
    ['kasuri methi', 'Kasoori Methi'],
    ['moong dal (whole)', 'Moong Dal Whole'],
    ['bhendi', 'Bhindi'],
    ['lime', 'Lemon'],
    ['chana dal', 'Channa Dal'],
  ])('%s IS satisfied by %s', (ingredient, pantryName) => {
    expect(match(ingredient, pantry(pantryName)).status).toBe('in_pantry');
  });

  it('keeps the parenthetical when it says which form of an item it is, and drops it when it only says how it is prepared', () => {
    expect(match('onion (finely chopped)', pantry('Onion')).status).toBe('in_pantry');
    expect(match('moong dal (split)', pantry('Moong Dal Split')).status).toBe('in_pantry');
  });
});

describe('matchIngredientToPantry — salt and water variants are assumed, not spent from the missing budget', () => {
  it.each(['sea salt', 'table salt', 'rock salt', 'iodised salt', 'pinch of salt', 'Salt.', 'salt, to taste', 'hot water'])('%s is assumed', (name) => {
    expect(match(name, []).status).toBe('assumed');
  });

  it('black salt (kala namak) is a real ingredient the household may lack, so it is not assumed', () => {
    expect(match('black salt', []).status).toBe('missing');
  });
});

describe('grounding uses the same text the prompt showed the model', () => {
  it('matches a very long pantry name by the truncated form the model was given, and reports the full stored name', () => {
    const longName = `Organic Stone Ground Whole Wheat Multigrain Chakki Fresh Atta ${'Special '.repeat(6)}Pack`;
    expect(longName.length).toBeGreaterThan(60);
    const shown = normalizeForPrompt(longName);
    expect(match(shown, pantry(longName))).toEqual({ status: 'in_pantry', pantryItemName: longName });
  });
});
