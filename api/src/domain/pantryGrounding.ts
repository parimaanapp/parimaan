import { normalizeForPrompt, PROMPT_LIMITS } from './cookPromptText.js';
import { namesMatch } from './shoppingListGeneration.js';

/**
 * W21 D3 — "grounded in your pantry" is enforced HERE, on the server, never
 * by trusting the model. The model proposes ingredient names; this module
 * decides, against the household's real pantry rows, which of them are in
 * the pantry. Pure, immutable, table-tested.
 *
 * Known failure modes, deliberately accepted and written down:
 *  - a false *Missing* when the model paraphrases outside the alias table
 *    (cheap: the user sees it and knows better);
 *  - a false *Have* when the fuzzy matcher collides (worse: someone may
 *    start cooking without the item). The fuzzy stage is therefore narrow: it
 *    only forgives a spelling difference inside one word (chilli/chili), never
 *    a different word, a different number of words or a short word, so "red"
 *    vs "green" chilli powder, "salted" vs "unsalted" butter and "pea" vs
 *    "pear" cannot meet. The dangerous pairs found in review are pinned in
 *    `pantryGrounding.test.ts`;
 *  - presence, not quantity: "in pantry" means some is on hand, never
 *    "enough";
 *  - "dal" against "toor dal" is deliberately NOT a match (containment
 *    matching would call urad dal "have" for a toor dal recipe).
 */

export type PantryMatchStatus = 'in_pantry' | 'missing' | 'assumed';

export interface PantryMatch {
  readonly status: PantryMatchStatus;
  /** The matched pantry row's OWN stored name; set if and only if `status` is `in_pantry`. Never model text. */
  readonly pantryItemName: string | null;
}

export interface PantryItemRef {
  readonly name: string;
  readonly category: string | null;
}

export interface GroundedIngredients {
  /** Exactly one entry per input ingredient, in the same order. */
  readonly ingredientMatches: readonly PantryMatch[];
  /** Distinct pantry-row names, in order of first use. */
  readonly have: readonly string[];
  /** The model's own wording for each ingredient that is missing (deduplicated). */
  readonly missing: readonly string[];
}

/** From the prompt's own promises, so the prompt and the drop rule cannot drift. */
export const MAX_MISSING_INGREDIENTS = PROMPT_LIMITS.missing;
export const MIN_PANTRY_MATCHES = PROMPT_LIMITS.minPantryItems;

/** Never counted as missing: every kitchen has them. */
export const ASSUMED_INGREDIENTS: ReadonlySet<string> = new Set([
  'water', 'hot water', 'warm water', 'cold water', 'salt', 'sea salt', 'table salt', 'rock salt', 'iodised salt', 'iodized salt',
]);

/**
 * canonical concept → every spelling that means it. Seeded from the S1 spike's
 * observed misses (`E2E_MVP_PLAN.md` §28.8), not invented. Keys and variants
 * go through the same normalisation as the names being compared, so plurals
 * and case need not be listed. A variant may belong to only one group
 * (checked at load): an alias table that maps a word two ways is a silent
 * false Have.
 */
export const INGREDIENT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  potato: ['aloo', 'alu', 'batata'],
  onion: ['pyaz', 'pyaaz', 'kanda'],
  tomato: ['tamatar'],
  ginger: ['adrak'],
  garlic: ['lehsun', 'lasun'],
  turmeric: ['haldi', 'turmeric powder', 'haldi powder'],
  cumin: ['jeera', 'zeera', 'cumin seed', 'jeera seed'],
  'coriander leaves': ['coriander', 'coriander leaf', 'cilantro', 'dhania', 'dhaniya', 'fresh coriander', 'hara dhania'],
  'coriander powder': ['dhania powder', 'dhaniya powder', 'ground coriander'],
  'coriander seed': ['dhania seed', 'sabut dhania'],
  // Deliberately NOT 'kashmiri chilli powder': a recipe that asks for it is not satisfied by plain chilli powder.
  'red chilli powder': ['lal mirch', 'lal mirch powder', 'chilli powder', 'red chili powder'],
  'green chilli': ['green chili', 'green chile', 'green chilly', 'hari mirch'],
  spinach: ['palak'],
  cauliflower: ['gobi', 'gobhi', 'phool gobhi'],
  okra: ['bhindi', 'bhendi', 'ladyfinger', 'lady finger'],
  peas: ['matar', 'green pea'],
  brinjal: ['baingan', 'eggplant', 'aubergine'],
  'bottle gourd': ['lauki', 'doodhi', 'dudhi', 'ghia', 'calabash'],
  'gram flour': ['besan', 'chickpea flour', 'chana flour'],
  'wheat flour': ['atta', 'aata', 'whole wheat flour', 'chapati flour'],
  semolina: ['suji', 'sooji', 'rava', 'rawa', 'sooji rava'],
  curd: ['dahi', 'yogurt', 'yoghurt', 'plain yogurt', 'plain curd'],
  ghee: ['clarified butter'],
  jaggery: ['gur', 'gud'],
  'mustard seed': ['rai', 'black mustard seed'],
  'carom seed': ['ajwain', 'carom', 'ajwain seed'],
  'fennel seed': ['saunf'],
  'nigella seed': ['kalonji'],
  'fenugreek seed': ['methi dana', 'methi seed'],
  // Bare "methi" is ambiguous (leaves or seeds) so it is deliberately in no group; dried leaves are a different product from fresh.
  'fenugreek leaves': ['fenugreek leaf', 'methi leaf', 'methi patta', 'fresh methi'],
  'dried fenugreek leaves': ['kasuri methi', 'kasoori methi', 'dried methi'],
  'dried mango powder': ['amchur', 'amchoor'],
  asafoetida: ['hing'],
  'curry leaf': ['kadi patta', 'kadipatta', 'kari patta'],
  lemon: ['nimbu', 'lime'],
  'toor dal': ['tur dal', 'tuvar dal', 'arhar dal', 'arhar', 'toor'],
  'moong dal': ['mung dal', 'yellow moong dal'],
  'masoor dal': ['red lentil'],
  'chana dal': ['bengal gram'],
};

/** "oil", "cooking oil" … : any oil the household has will do (the S1 spike's most common false Missing). */
const GENERIC_OIL_KEYS: ReadonlySet<string> = new Set(['oil', 'cooking oil', 'vegetable oil', 'refined oil', 'frying oil', 'oil for frying', 'oil for cooking', 'oil for deep frying']);

/** An oil that is not for cooking never satisfies a recipe's "oil". */
const NON_COOKING_OIL_WORDS: ReadonlySet<string> = new Set(['castor', 'essential', 'hair', 'massage', 'camphor', 'tea', 'baby', 'engine']);

/** "Rice" in a recipe means cooking rice; these are different foods (and "rice flour" ends in a different word anyway). */
const NOT_COOKING_RICE_WORDS: ReadonlySet<string> = new Set(['puffed', 'flattened', 'popped', 'beaten', 'poha', 'muri', 'paper']);

const singularizeWord = (word: string): string => {
  if (word.length <= 3) {
    return word;
  }
  if (word.endsWith('ies')) {
    return `${word.slice(0, -3)}i`;
  }
  if (word.endsWith('oes')) {
    return word.slice(0, -2);
  }
  return word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') ? word.slice(0, -1) : word;
};

/**
 * The comparison key for one ingredient name: drops a preparation note after a
 * comma and any parenthetical, lowercases, collapses spaces, drops "to taste",
 * and singularises the last word. Applied identically to both sides, so the
 * exact singular form does not matter, only that "potatoes" and "potato" meet.
 */
const FORM_PARENTHETICAL = /\((?=[^)]*\b(?:whole|split|sabut|husked|skinless|dry|dried)\b)([^)]*)\)/g;

const canonicalKey = (raw: string): string => {
  const cleaned = (raw.split(',')[0] ?? '')
    // "moong dal (whole)" says which product it is, so it is kept; "onion (chopped)" only says how it is prepared, so it is dropped.
    .replace(FORM_PARENTHETICAL, ' $1 ')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[.;:!]+/g, ' ')
    .replace(/\bto taste\b|\bas needed\b|^(?:a )?(?:pinch|dash) of /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned === '' ? [] : cleaned.split(' ');
  const last = words.at(-1);
  return last === undefined ? '' : [...words.slice(0, -1), singularizeWord(last)].join(' ');
};

const buildAliasIndex = (): ReadonlyMap<string, string> => {
  const index = new Map<string, string>();
  const claim = (spelling: string, concept: string): void => {
    const existing = index.get(spelling);
    if (existing !== undefined && existing !== concept) {
      throw new Error(`Alias "${spelling}" maps to both "${existing}" and "${concept}".`);
    }
    index.set(spelling, concept);
  };
  for (const [concept, variants] of Object.entries(INGREDIENT_ALIASES)) {
    const conceptKey = canonicalKey(concept);
    claim(conceptKey, conceptKey);
    for (const variant of variants) {
      claim(canonicalKey(variant), conceptKey);
    }
  }
  return index;
};

const ALIAS_INDEX = buildAliasIndex();

const conceptOf = (key: string): string => ALIAS_INDEX.get(key) ?? key;

const lastWord = (key: string): string => key.split(' ').at(-1) ?? '';

const byName = (a: PantryItemRef, b: PantryItemRef): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Stable choice among equally good matches: the alphabetically first pantry name. */
const firstByName = (candidates: readonly PantryItemRef[]): PantryItemRef | undefined => [...candidates].sort(byName)[0];

const MIN_FUZZY_WORD_LENGTH = 5;

/**
 * Spelling tolerance only: same number of words, and every word that differs
 * is a long word that starts the same and is Dice-similar ("chilli"/"chili",
 * "chana"/"channa"). Never a different word ("red"/"green"), a short word
 * ("pea"/"pear"), a sign word ("salted"/"unsalted": different first letters)
 * or an extra word ("moong dal"/"moong dal dry").
 */
const spellingVariant = (a: string, b: string): boolean => {
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  return (
    wordsA.length === wordsB.length &&
    wordsA.every((word, i) => {
      const other = wordsB[i] ?? '';
      return (
        word === other ||
        (word.length >= MIN_FUZZY_WORD_LENGTH && other.length >= MIN_FUZZY_WORD_LENGTH && word.slice(0, 3) === other.slice(0, 3) && namesMatch(word, other))
      );
    })
  );
};

const inPantry = (item: PantryItemRef): PantryMatch => ({ status: 'in_pantry', pantryItemName: item.name });
const MISSING: PantryMatch = { status: 'missing', pantryItemName: null };
const ASSUMED: PantryMatch = { status: 'assumed', pantryItemName: null };

export const matchIngredientToPantry = (ingredientName: string, pantry: readonly PantryItemRef[]): PantryMatch => {
  const key = canonicalKey(ingredientName);
  if (key === '') {
    return MISSING;
  }
  if (ASSUMED_INGREDIENTS.has(key)) {
    return ASSUMED;
  }
  // Each row is known by two keys: its stored name and the (possibly truncated) form the model was shown in the prompt.
  const keyed = pantry
    .map((item) => ({ item, keys: [...new Set([canonicalKey(item.name), canonicalKey(normalizeForPrompt(item.name))])].filter((k) => k !== '') }))
    .filter((entry) => entry.keys.length > 0);

  const stages: (() => PantryItemRef | undefined)[] = [
    () => firstByName(keyed.filter((entry) => entry.keys.includes(key)).map((entry) => entry.item)),
    () => firstByName(keyed.filter((entry) => entry.keys.some((k) => conceptOf(k) === conceptOf(key))).map((entry) => entry.item)),
    () => genericHeadMatch(key, keyed),
    () => firstByName(keyed.filter((entry) => entry.keys.some((k) => spellingVariant(key, k))).map((entry) => entry.item)),
  ];
  for (const stage of stages) {
    const found = stage();
    if (found !== undefined) {
      return inPantry(found);
    }
  }
  return MISSING;
};

type KeyedPantryItem = { readonly item: PantryItemRef; readonly keys: readonly string[] };

const hasWordIn = (keys: readonly string[], words: ReadonlySet<string>): boolean => keys.some((k) => k.split(' ').some((w) => words.has(w)));

const genericHeadMatch = (key: string, keyed: readonly KeyedPantryItem[]): PantryItemRef | undefined => {
  if (GENERIC_OIL_KEYS.has(key)) {
    return firstByName(
      keyed
        .filter((entry) => (entry.item.category?.trim().toLowerCase() === 'oil' || entry.keys.some((k) => lastWord(k) === 'oil')) && !hasWordIn(entry.keys, NON_COOKING_OIL_WORDS))
        .map((entry) => entry.item),
    );
  }
  if (key === 'rice') {
    return firstByName(keyed.filter((entry) => entry.keys.some((k) => lastWord(k) === 'rice') && !hasWordIn(entry.keys, NOT_COOKING_RICE_WORDS)).map((entry) => entry.item));
  }
  return undefined;
};

export const groundSuggestion = (ingredientNames: readonly string[], pantry: readonly PantryItemRef[]): GroundedIngredients => {
  const ingredientMatches = ingredientNames.map((name) => matchIngredientToPantry(name, pantry));
  const have = [...new Set(ingredientMatches.flatMap((m) => (m.pantryItemName === null ? [] : [m.pantryItemName])))];
  const missing = [...new Set(ingredientNames.filter((_, i) => ingredientMatches[i]?.status === 'missing'))];
  return { ingredientMatches, have, missing };
};

/** D3's drop rule: enough of the recipe is really in the pantry, and not too much is missing. */
export const isGroundedEnough = (grounded: Pick<GroundedIngredients, 'have' | 'missing'>): boolean =>
  grounded.have.length >= MIN_PANTRY_MATCHES && grounded.missing.length <= MAX_MISSING_INGREDIENTS;
