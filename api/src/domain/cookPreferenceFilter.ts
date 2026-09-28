import { DIETARY_TAG_VALUES } from './dietaryTags.js';

/**
 * W21 D4 — the household's rules, applied to what the model proposed. The
 * prompt already asks for them; this is the enforcement, because a model
 * that is told a household is vegetarian will still sometimes return
 * chicken, and its own dietary self-tags are not trusted. (Measured in the
 * S1 spike: the model tagged plain atta dishes "gluten_free".)
 *
 * Skip list and dietary tags are HARD filters (W10 D7: an automated path with
 * no human in the loop hard-filters). Allergens WARN, never hide (PRD §7.1's
 * warn-not-hide rule). Cuisine bias is soft guidance in the prompt only and is
 * not applied here at all.
 *
 * Every keyword list below is a judgement about which way to err: a word missing
 * from a list is a rule silently not enforced (worse), a word wrongly on it
 * drops a good suggestion (cheaper, and the household simply sees another).
 */

export interface FilterableSuggestion {
  readonly title: string;
  readonly dietaryTags: readonly string[];
  readonly ingredients: readonly { readonly name: string }[];
}

/** NFKC + lowercase, the same compatibility normalisation the prompt applies, so a term typed in fullwidth or mixed forms is enforced as the model was shown it. */
const fold = (text: string): string => text.normalize('NFKC').toLowerCase();

const texts = (suggestion: FilterableSuggestion): string[] => [suggestion.title, ...suggestion.ingredients.map((i) => i.name)].map(fold);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "coconut milk", "peanut butter", "soy milk" are plant foods, not dairy. Applies to DAIRY words only: "coconut chicken" is still chicken. */
const PLANT_PREFIX = '(?:coconut|almond|soy|soya|oat|peanut|cashew|rice|cocoa|shea|nut|plant|vegan)\\s+';

const regexCache = new Map<string, RegExp>();

/**
 * Whole-word match with an optional plural ("egg"/"eggs", "anchovy"/"anchovies"):
 * "eggplant" is not "egg", "butternut" is not "butter". Built once per word.
 */
const wordPattern = (word: string, plantExempt: boolean): RegExp => {
  const key = `${word}|${String(plantExempt)}`;
  const cached = regexCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const body = word.endsWith('y') ? `${escapeRegExp(word.slice(0, -1))}(?:y|ies)` : `${escapeRegExp(word)}(?:s|es)?`;
  const built = new RegExp(`(?<![a-z])${plantExempt ? `(?<!${PLANT_PREFIX})` : ''}${body}(?![a-z])`);
  regexCache.set(key, built);
  return built;
};

/**
 * Phrases that contain a keyword but are harmless, removed before matching:
 * "egg-free mayo", "meatless mince" (the word it says the product is free of,
 * plus the product), any other "-free" marker, goat cheese (not meat), butter
 * beans, cream of tartar.
 */
const HARMLESS_PHRASES = /\b(?:egg|dairy|meat|gluten)-free(?: [a-z]+)?\b|\b[a-z]+-free\b|\b(?:meat|egg|dairy|gluten)less(?: [a-z]+)?\b|\bgoat(?:'s)? (?:cheese|milk)\b|\bbutter beans?\b|\bcream of tartar\b/g;

const neutralise = (text: string): string => text.replace(HARMLESS_PHRASES, ' ');

/** Case-insensitive substring on ingredient names (the auto-fill skip filter's `ILIKE %term%`, but `%` and `_` in a term are literal); whole-word on the title, so "oil" does not drop "Boiled Egg". A phrase such as "no raw onion" matches nothing, as in auto-fill. */
export const findSkipViolations = (suggestion: FilterableSuggestion, skipIngredients: readonly string[]): string[] => {
  const seen = new Set<string>();
  const title = fold(suggestion.title);
  const ingredientTexts = suggestion.ingredients.map((i) => fold(i.name));
  return skipIngredients.filter((term) => {
    const lower = fold(term).trim();
    if (lower === '' || seen.has(lower)) {
      return false;
    }
    seen.add(lower);
    return ingredientTexts.some((text) => text.includes(lower)) || wordPattern(lower, false).test(title);
  });
};

const MEAT_AND_FISH = [
  'chicken', 'mutton', 'lamb', 'goat', 'beef', 'pork', 'bacon', 'ham', 'turkey', 'duck', 'lard', 'gelatin', 'gelatine', 'mince', 'keema', 'sausage', 'meat',
  'fish', 'prawn', 'shrimp', 'crab', 'lobster', 'oyster', 'clam', 'mussel', 'squid', 'salmon', 'tuna', 'sardine', 'mackerel', 'anchovy', 'rohu', 'pomfret', 'hilsa',
];
const EGG = ['egg', 'mayonnaise', 'mayo'];
const DAIRY = [
  'milk', 'paneer', 'cheese', 'curd', 'dahi', 'yogurt', 'yoghurt', 'ghee', 'butter', 'buttermilk', 'cream', 'malai', 'khoa', 'khowa', 'mawa', 'whey',
  'lassi', 'chaas', 'makhan', 'shrikhand', 'chhena', 'kefir',
];
const ROOT_VEG_FOR_JAIN = [
  'onion', 'garlic', 'potato', 'aloo', 'alu', 'ginger', 'adrak', 'carrot', 'radish', 'mooli', 'beetroot', 'turnip', 'shallot', 'pyaz', 'pyaaz', 'lehsun',
  'yam', 'suran', 'arbi', 'colocasia', 'mushroom',
];
/** Grains that make a flatbread, bread or noodle gluten-free; their presence exempts the generic bread words below. */
const GLUTEN_FREE_GRAIN = /\b(?:besan|jowar|bajra|ragi|rice|millet|makki|corn|buckwheat|kuttu|gluten)\b/;
const GLUTEN_DEPENDS_ON_GRAIN = ['roti', 'chapati', 'paratha', 'naan', 'bread', 'pasta', 'noodle'];
const GLUTEN = [
  'wheat', 'atta', 'maida', 'semolina', 'suji', 'sooji', 'rava', 'rawa', 'couscous', 'seitan', 'barley', 'rye', 'pav', 'puri', 'bhatura', 'kulcha', 'dalia',
  'vermicelli', 'sevai', 'all purpose flour', 'all-purpose flour', 'plain flour', 'refined flour', 'soy sauce', ...GLUTEN_DEPENDS_ON_GRAIN,
];

/** For each household tag, the ingredient words that break it. Kept as data so the table is reviewable at a glance. */
export const DIETARY_VIOLATION_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  veg: [...MEAT_AND_FISH, ...EGG],
  vegan: [...MEAT_AND_FISH, ...EGG, ...DAIRY, 'honey'],
  jain: [...MEAT_AND_FISH, ...EGG, ...ROOT_VEG_FOR_JAIN],
  eggetarian: MEAT_AND_FISH,
  dairy_free: DAIRY,
  gluten_free: GLUTEN,
};

/** A suggestion tagged with the key also satisfies the tags it implies (a vegan dish is a vegetarian and a dairy-free one). */
const IMPLIED_TAGS: Readonly<Record<string, readonly string[]>> = {
  vegan: ['veg', 'eggetarian', 'dairy_free'],
  jain: ['veg', 'eggetarian'],
  veg: ['eggetarian'],
};

const DAIRY_WORDS: ReadonlySet<string> = new Set(DAIRY);
const GRAIN_DEPENDENT_WORDS: ReadonlySet<string> = new Set(GLUTEN_DEPENDS_ON_GRAIN);

/** Whether `text` (already neutralised) contains `word`, applying the exemptions that belong to that word's family. */
const mentions = (text: string, word: string): boolean => {
  if (!wordPattern(word, DAIRY_WORDS.has(word)).test(text)) {
    return false;
  }
  return !(GRAIN_DEPENDENT_WORDS.has(word) && GLUTEN_FREE_GRAIN.test(text));
};

const normalizeTag = (tag: string): string => tag.trim().toLowerCase();

export const findDietaryViolations = (suggestion: FilterableSuggestion, householdTags: readonly string[]): string[] => {
  const required = [...new Set(householdTags.map(normalizeTag))].filter((tag) => (DIETARY_TAG_VALUES as readonly string[]).includes(tag));
  const claimed = new Set(suggestion.dietaryTags.map(normalizeTag));
  for (const tag of [...claimed]) {
    (IMPLIED_TAGS[tag] ?? []).forEach((implied) => claimed.add(implied));
  }
  const clean = texts(suggestion).map(neutralise);
  return required.flatMap((tag) => [
    ...(claimed.has(tag) ? [] : [`Not tagged ${tag}`]),
    ...(DIETARY_VIOLATION_KEYWORDS[tag] ?? []).filter((word) => clean.some((text) => mentions(text, word))).map((word) => `Contains ${word} (not ${tag})`),
  ]);
};

const TREE_NUTS = ['almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan', 'macadamia', 'brazil nut', 'pine nut'];
const SHELLFISH = ['prawn', 'shrimp', 'crab', 'lobster', 'oyster', 'clam', 'mussel', 'squid'];
const FISH = [...SHELLFISH, 'fish', 'salmon', 'tuna', 'sardine', 'mackerel', 'anchovy', 'rohu', 'pomfret', 'hilsa'];
const PEANUT = ['peanut', 'groundnut', 'moongphali'];

/**
 * Household allergens are free text ("tree nuts", "dairy", "shellfish"), and a
 * plain substring test would stay silent for almost all of them, so each known
 * allergen word expands to the foods it covers. Anything unknown is matched as
 * a whole word, as typed.
 */
const ALLERGEN_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  nut: [...TREE_NUTS, ...PEANUT],
  'tree nut': TREE_NUTS,
  peanut: PEANUT,
  dairy: DAIRY,
  milk: DAIRY,
  lactose: DAIRY,
  gluten: GLUTEN,
  wheat: ['wheat', 'atta', 'maida', 'semolina', 'suji', 'sooji', 'rava', 'rawa'],
  shellfish: SHELLFISH,
  fish: FISH,
  egg: EGG,
  soy: ['soy', 'soya', 'tofu', 'edamame', 'miso', 'tempeh', 'soy sauce'],
  sesame: ['sesame', 'til', 'tahini'],
};

const allergenStem = (allergen: string): string => {
  const lower = fold(allergen).trim().replace(/\s+allerg(?:y|ies)$/, '');
  return lower.length > 3 && lower.endsWith('s') ? lower.slice(0, -1) : lower;
};

/** One warning per allergen found, in the household's own words. */
export const allergenWarnings = (suggestion: FilterableSuggestion, allergens: readonly string[]): string[] => {
  const clean = texts(suggestion).map(neutralise);
  const seen = new Set<string>();
  return allergens.flatMap((allergen) => {
    const name = allergen.trim();
    const stem = allergenStem(allergen);
    if (name === '' || seen.has(stem)) {
      return [];
    }
    seen.add(stem);
    const words = ALLERGEN_KEYWORDS[stem] ?? [stem];
    return words.some((word) => clean.some((text) => mentions(text, word))) ? [`Contains ${name} — on your household's allergen list`] : [];
  });
};
