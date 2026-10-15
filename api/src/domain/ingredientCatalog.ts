/**
 * Pure ingredient-catalog domain: key normalisation, resolution of a free-text
 * ingredient name to a catalog entry, and search. No I/O; the catalog is passed
 * in (loaded from Postgres by `repositories/catalogRepository.ts`).
 *
 * Resolution is deliberately conservative: it either finds exactly one entry by
 * a documented rule, reports a collision as `ambiguous` with every candidate,
 * or returns `null`. It never picks between candidates and never matches by a
 * subset of tokens (so "tomato sauce" cannot degrade to the produce "Tomato").
 */

/** Approved UI labels per stored category value (E2E_MVP_PLAN.md §32.6). */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  dal: 'Dal',
  grain: 'Grain',
  spice: 'Spice',
  dairy: 'Dairy',
  eggs: 'Eggs',
  produce: 'Produce',
  dry_goods: 'Dry Goods',
  oil: 'Oil',
  meat_fish: 'Meat & Fish',
  condiment: 'Condiment',
  bakery: 'Bakery',
  snacks: 'Snacks',
  beverages: 'Beverages',
  frozen: 'Frozen',
  other: 'Other',
};

/** Label for a category value; an unknown value is returned unchanged. */
export const categoryLabel = (category: string): string => CATEGORY_LABELS[category] ?? category;

/**
 * Bump when `normaliseKey`/`foldPlural` change in a way that alters alias keys,
 * so the deploy-time catalog sync re-runs even if the bundled data did not.
 */
export const NORMALISER_VERSION = 1;

export interface CatalogEntry {
  readonly id: string;
  readonly canonicalName: string;
  readonly appCategory: string;
  readonly subcategory: string;
  readonly allowedUnits: readonly string[];
  readonly defaultUnit: string;
  readonly pieceG: number | null;
  readonly cupG: number | null;
  readonly note: string;
  readonly aliases: readonly string[];
}

export type ResolveVia = 'canonical' | 'alias' | 'singular' | 'token_set' | 'head_noun';

export type ResolveResult =
  | { readonly status: 'resolved'; readonly entry: CatalogEntry; readonly via: ResolveVia }
  | { readonly status: 'ambiguous'; readonly candidates: readonly CatalogEntry[] };

export interface NormaliseKeyOptions {
  /** Keep the words inside (...) / [...] instead of dropping them. Catalog names use this ("Bread (White)" -> "bread white"). */
  readonly keepParentheticals?: boolean;
}

const COMBINING_LATIN_MARKS = /[̀-ͯ]/g;
const PARENTHETICAL = /\([^)]*\)|\[[^\]]*\]/g;
const UNBALANCED_TAIL = /[([][^)\]]*$/;
const APOSTROPHES = /['‘’ʼ`]/g;
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/gu;
const MAX_KEY_LENGTH = 200;

/**
 * Canonical comparison key: NFC, lower-case, Latin diacritics stripped (Indic
 * combining marks are kept), apostrophes removed, other punctuation to spaces,
 * "&" read as "and", whitespace collapsed, prep-note parentheticals dropped.
 */
export const normaliseKey = (text: string, options: NormaliseKeyOptions = {}): string => {
  let value = text.normalize('NFD').replace(COMBINING_LATIN_MARKS, '').normalize('NFC').toLowerCase();
  value = value.replace(/&/g, ' and ');
  if (options.keepParentheticals !== true) {
    value = value.replace(PARENTHETICAL, ' ').replace(UNBALANCED_TAIL, ' ');
  }
  value = value.replace(APOSTROPHES, '').replace(NON_WORD, ' ').trim().replace(/ {2,}/g, ' ');
  return value.slice(0, MAX_KEY_LENGTH);
};

const MIN_FOLD_LENGTH = 4;
const SIBILANT_ES = /(ch|sh|ss|x|z)es$/;

/**
 * Folds one English word to a singular-ish stem used only for comparison, so
 * both sides of a match fold the same way (it never has to be a real word):
 * tomatoes->tomato, chillies/chilli->chilli, cherries/cherry->cherri, peas->pea.
 */
export const foldPlural = (word: string): string => {
  if (word.length < MIN_FOLD_LENGTH) {
    return word;
  }
  if (word.endsWith('ies')) {
    return `${word.slice(0, -3)}i`;
  }
  if (/[^aeiou]y$/.test(word)) {
    return `${word.slice(0, -1)}i`;
  }
  if (word.endsWith('oes') || SIBILANT_ES.test(word)) {
    return word.slice(0, -2);
  }
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) {
    return word;
  }
  return word.endsWith('s') ? word.slice(0, -1) : word;
};

const foldKey = (key: string): string => key.split(' ').map(foldPlural).join(' ');
const tokenSetKey = (key: string): string => key.split(' ').filter(Boolean).sort().join(' ');

/** Descriptors that never change which product is meant. */
const FILLER_WORDS: ReadonlySet<string> = new Set(['fresh', 'organic', 'large', 'small', 'medium', 'big']);
const MAX_TOKENS = 8;
const HEAD_NOUN = 'dal';
const HEAD_NOUN_CATEGORY = 'dal';
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;

type KeyMap = Map<string, Map<string, CatalogEntry>>;

export interface CatalogIndex {
  readonly entries: readonly CatalogEntry[];
  readonly canonical: KeyMap;
  readonly alias: KeyMap;
  readonly canonicalFolded: KeyMap;
  readonly aliasFolded: KeyMap;
  readonly canonicalTokens: KeyMap;
  readonly aliasTokens: KeyMap;
  readonly searchable: readonly SearchRow[];
}

interface SearchRow {
  readonly entry: CatalogEntry;
  readonly name: string;
  readonly aliases: readonly string[];
}

const addTo = (map: KeyMap, key: string, entry: CatalogEntry): void => {
  if (key === '') {
    return;
  }
  const bucket = map.get(key) ?? new Map<string, CatalogEntry>();
  bucket.set(entry.id, entry);
  map.set(key, bucket);
};

/** Builds lookup maps once; the index is immutable afterwards. */
export const buildCatalogIndex = (entries: readonly CatalogEntry[]): CatalogIndex => {
  const canonical: KeyMap = new Map();
  const alias: KeyMap = new Map();
  const canonicalFolded: KeyMap = new Map();
  const aliasFolded: KeyMap = new Map();
  const canonicalTokens: KeyMap = new Map();
  const aliasTokens: KeyMap = new Map();
  const searchable: SearchRow[] = [];

  for (const entry of entries) {
    const nameKey = normaliseKey(entry.canonicalName, { keepParentheticals: true });
    addTo(canonical, nameKey, entry);
    addTo(canonicalFolded, foldKey(nameKey), entry);
    addTo(canonicalTokens, tokenSetKey(foldKey(nameKey)), entry);

    const aliasKeys = new Set<string>();
    for (const rawAlias of entry.aliases) {
      const aliasKey = normaliseKey(rawAlias, { keepParentheticals: true });
      if (aliasKey === '' || aliasKey === nameKey || aliasKeys.has(aliasKey)) {
        continue;
      }
      aliasKeys.add(aliasKey);
      addTo(alias, aliasKey, entry);
      addTo(aliasFolded, foldKey(aliasKey), entry);
      addTo(aliasTokens, tokenSetKey(foldKey(aliasKey)), entry);
    }
    searchable.push({ entry, name: nameKey, aliases: [...aliasKeys] });
  }

  return {
    entries,
    canonical,
    alias,
    canonicalFolded,
    aliasFolded,
    canonicalTokens,
    aliasTokens,
    searchable,
  };
};

const byId = (a: CatalogEntry, b: CatalogEntry): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const outcome = (bucket: Map<string, CatalogEntry> | undefined, via: ResolveVia): ResolveResult | null => {
  if (bucket === undefined || bucket.size === 0) {
    return null;
  }
  const candidates = [...bucket.values()].sort(byId);
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) {
    return { status: 'resolved', entry: only, via };
  }
  return { status: 'ambiguous', candidates };
};

/** Canonical names are tried before aliases at every stage, so a real name always beats a colliding alias. */
const firstOutcome = (
  canonicalMap: KeyMap,
  aliasMap: KeyMap,
  key: string,
  via: ResolveVia,
): ResolveResult | null =>
  outcome(canonicalMap.get(key), via) ?? outcome(aliasMap.get(key), via);

const matchKey = (key: string, index: CatalogIndex): ResolveResult | null => {
  const canonical = outcome(index.canonical.get(key), 'canonical');
  if (canonical !== null) {
    return canonical;
  }
  const alias = outcome(index.alias.get(key), 'alias');
  if (alias !== null) {
    return alias;
  }
  const folded = foldKey(key);
  const singular = firstOutcome(index.canonicalFolded, index.aliasFolded, folded, 'singular');
  if (singular !== null) {
    return singular;
  }
  return firstOutcome(index.canonicalTokens, index.aliasTokens, tokenSetKey(folded), 'token_set');
};

/**
 * "tuvar" -> "tuvar dal": a lone token is completed with "dal" and accepted
 * only when the completed name resolves to an entry in the dal category, so
 * it can never cross categories.
 */
const matchHeadNoun = (key: string, index: CatalogIndex): ResolveResult | null => {
  if (key === '' || key.includes(' ')) {
    return null;
  }
  const result = matchKey(`${key} ${HEAD_NOUN}`, index);
  if (result === null || result.status !== 'resolved') {
    return null;
  }
  return result.entry.appCategory === HEAD_NOUN_CATEGORY
    ? { status: 'resolved', entry: result.entry, via: 'head_noun' }
    : null;
};

const resolveKey = (key: string, index: CatalogIndex): ResolveResult | null => {
  if (key === '' || key.split(' ').length > MAX_TOKENS) {
    return null;
  }
  const direct = matchKey(key, index);
  if (direct !== null) {
    return direct;
  }
  const headNoun = matchHeadNoun(key, index);
  if (headNoun !== null) {
    return headNoun;
  }
  const tokens = key.split(' ');
  const stripped = tokens.filter((token) => !FILLER_WORDS.has(token));
  if (stripped.length > 0 && stripped.length < tokens.length) {
    return matchKey(stripped.join(' '), index);
  }
  return null;
};

/**
 * Resolves a free-text ingredient name. Stages, first hit wins: exact canonical
 * name, exact alias, singular/plural folding, token-set (word order), lone-token
 * dal completion, then the same again after dropping filler words (fresh,
 * organic, ...). Parenthetical qualifiers are tried as part of the name first
 * ("Bread (White)") and then dropped as prep notes ("Onion (chopped)").
 *
 * Returns `null` when nothing matches safely, `ambiguous` (all candidates,
 * sorted by id) when a key belongs to more than one entry.
 */
export const resolveIngredient = (name: string, index: CatalogIndex): ResolveResult | null => {
  const withQualifiers = normaliseKey(name, { keepParentheticals: true });
  const withoutQualifiers = normaliseKey(name);
  const first = resolveKey(withQualifiers, index);
  if (first !== null || withoutQualifiers === withQualifiers) {
    return first;
  }
  return resolveKey(withoutQualifiers, index);
};

const matchTier = (query: string, name: string, aliases: readonly string[]): number | null => {
  const words = (text: string): string[] => text.split(' ');
  const checks: ReadonlyArray<readonly [number, (text: string) => boolean, boolean]> = [
    [0, (text) => text === query, true],
    [1, (text) => text === query, false],
    [2, (text) => text.startsWith(query), true],
    [3, (text) => text.startsWith(query), false],
    [4, (text) => words(text).some((word) => word.startsWith(query)), true],
    [5, (text) => words(text).some((word) => word.startsWith(query)), false],
    [6, (text) => text.includes(query), true],
    [7, (text) => text.includes(query), false],
  ];
  for (const [tier, test, onName] of checks) {
    const hit = onName ? test(name) : aliases.some(test);
    if (hit) {
      return tier;
    }
  }
  return null;
};

/**
 * Ranked search over names and aliases: exact name, exact alias, name prefix,
 * alias prefix, name word-prefix, alias word-prefix, name substring, alias
 * substring. A query that matches nothing as typed is retried plural-folded.
 * Ties break on shorter name, then id, so results are deterministic.
 */
export const searchCatalog = (
  query: string,
  index: CatalogIndex,
  limit: number = DEFAULT_SEARCH_LIMIT,
): readonly CatalogEntry[] => {
  const key = normaliseKey(query, { keepParentheticals: true });
  if (key === '') {
    return [];
  }
  const safeLimit = Number.isFinite(limit)
    ? Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)))
    : DEFAULT_SEARCH_LIMIT;

  const rank = (queryKey: string, fold: boolean): Array<{ entry: CatalogEntry; tier: number; name: string }> => {
    const ranked: Array<{ entry: CatalogEntry; tier: number; name: string }> = [];
    for (const row of index.searchable) {
      const name = fold ? foldKey(row.name) : row.name;
      const aliases = fold ? row.aliases.map(foldKey) : row.aliases;
      const tier = matchTier(queryKey, name, aliases);
      if (tier !== null) {
        ranked.push({ entry: row.entry, tier, name: row.name });
      }
    }
    return ranked;
  };

  const direct = rank(key, false);
  const ranked = direct.length > 0 ? direct : rank(foldKey(key), true);
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.name.length - b.name.length ||
      byId(a.entry, b.entry),
  );
  return ranked.slice(0, safeLimit).map((item) => item.entry);
};
