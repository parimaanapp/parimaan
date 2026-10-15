import { canonicaliseUnit } from './ingredientNormalisation/units.js';

/**
 * A single parsed ingredient. `raw` is kept verbatim on every path — nothing
 * this parser cannot decompose is ever silently dropped (E2E_MVP_PLAN.md
 * §13.3 S4). `name` always has a value (falls back to `raw` itself when
 * nothing else could be isolated); every other field is nullable.
 */
export interface ParsedIngredient {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

/** Matches a mixed number ("1 1/2"), a simple fraction ("1/2"), or a plain int/decimal ("2", "1.5") — the only quantity shapes seen across S1's 20 real fixtures. */
const NUMERIC_TOKEN_SOURCE = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?';
const LEADING_QUANTITY_PATTERN = new RegExp(`^\\s*(${NUMERIC_TOKEN_SOURCE})\\s*`);
const PURE_NUMERIC_TOKEN_PATTERN = new RegExp(`^(${NUMERIC_TOKEN_SOURCE})$`);

/** Vulgar-fraction characters mapped to ASCII fractions. */
const UNICODE_FRACTIONS: Readonly<Record<string, string>> = {
  '\u00bd': '1/2', '\u2153': '1/3', '\u2154': '2/3', '\u00bc': '1/4', '\u00be': '3/4',
  '\u2155': '1/5', '\u2156': '2/5', '\u2157': '3/5', '\u2158': '4/5', '\u2159': '1/6', '\u215a': '5/6',
  '\u2150': '1/7', '\u215b': '1/8', '\u215c': '3/8', '\u215d': '5/8', '\u215e': '7/8', '\u2151': '1/9', '\u2152': '1/10',
};
const UNICODE_FRACTION_PATTERN = new RegExp(`(\\d?)([${Object.keys(UNICODE_FRACTIONS).join('')}])`, 'g');

/** "1\u00bd" -> "1 1/2", "\u00bd" -> "1/2". Leaves every other character alone, so no fraction glyph can survive into a name. */
export const normaliseUnicodeFractions = (text: string): string =>
  text.replace(UNICODE_FRACTION_PATTERN, (_match, digit: string, glyph: string) => `${digit === '' ? '' : `${digit} `}${UNICODE_FRACTIONS[glyph]}`);

const RANGE_PATTERN = new RegExp(`^\\s*(${NUMERIC_TOKEN_SOURCE})\\s*(?:-|\\u2013|\\u2014|to)\\s*(${NUMERIC_TOKEN_SOURCE})(?![\\d/.])\\s*`, 'i');

/**
 * No real recipe calls for this much of an ingredient — a sanity ceiling
 * against an adversarial digit run (e.g. a 400-digit numerator), which
 * without a bound would satisfy `number | null` with `Infinity` (the same
 * class of bug `typescript-reviewer` flagged in `jsonLd/duration.ts` and
 * `jsonLd/yield.ts`).
 */
const MAX_REASONABLE_QUANTITY = 100_000;

/** Converts an already-isolated numeric token (matched by `NUMERIC_TOKEN_SOURCE`) to a `number`, or `null` for a zero-denominator fraction ("1/0") or an implausibly large result — never `Infinity`/`NaN` silently satisfying the return type. */
const parseQuantityToken = (token: string): number | null => {
  const mixedMatch = /^(\d+)\s+(\d+)\/(\d+)$/.exec(token);
  if (mixedMatch) {
    const denominator = Number(mixedMatch[3]);
    if (denominator === 0) {
      return null;
    }
    return sanitizeQuantity(Number(mixedMatch[1]) + Number(mixedMatch[2]) / denominator);
  }
  const fractionMatch = /^(\d+)\/(\d+)$/.exec(token);
  if (fractionMatch) {
    const denominator = Number(fractionMatch[2]);
    if (denominator === 0) {
      return null;
    }
    return sanitizeQuantity(Number(fractionMatch[1]) / denominator);
  }
  return sanitizeQuantity(Number(token.replace(/,/g, '')));
};

const sanitizeQuantity = (value: number): number | null => (Number.isFinite(value) && value >= 0 && value <= MAX_REASONABLE_QUANTITY ? value : null);

/**
 * Coerces a bare quantity string to a clean number where possible, falling
 * back to `null` with the original text preserved as `leftoverText` rather
 * than losing it. Reused by both `parseIngredientString` below (JSON-LD's
 * always-string `recipeIngredient` field) and S3's Gemini-response
 * normalisation, whose `quantity` field also arrives as a string — a
 * numeric-looking one ("2") parses to a number, a genuinely vague one ("a
 * fistful", "double the rava") falls back to `null` with the phrase kept so
 * the caller can fold it into the ingredient's own name (§13.2.2's own
 * finding on this). One utility, two call sites, not two designs.
 */
export const coerceQuantityText = (text: string): { quantity: number | null; leftoverText: string | null } => {
  const original = text.trim();
  if (original === '') {
    return { quantity: null, leftoverText: null };
  }
  const trimmed = normaliseUnicodeFractions(original).replace(/\s+/g, ' ').trim();
  if (!PURE_NUMERIC_TOKEN_PATTERN.test(trimmed)) {
    return { quantity: null, leftoverText: original };
  }
  // A numeric-shaped token (e.g. "1/0", or a digit run past
  // `MAX_REASONABLE_QUANTITY`) that `parseQuantityToken` itself rejects
  // still preserves the original text as `leftoverText` rather than
  // silently losing it — the same "never drop the source text" contract
  // this module documents everywhere else.
  const quantity = parseQuantityToken(trimmed);
  return quantity === null ? { quantity: null, leftoverText: original } : { quantity, leftoverText: null };
};

const FULL_RANGE_PATTERN = new RegExp(`^(${NUMERIC_TOKEN_SOURCE})\\s*(?:-|\\u2013|\\u2014|to)\\s*(${NUMERIC_TOKEN_SOURCE})$`, 'i');

/** A whole quantity string that is a range ("2-3", "2 to 3", "1/2-1"): the lower bound plus the range as a note, or null when it is not a range. */
export const parseQuantityRange = (text: string): { quantity: number; rangeNote: string } | null => {
  const match = FULL_RANGE_PATTERN.exec(normaliseUnicodeFractions(text.trim()).replace(/\s+/g, ' '));
  const quantity = match ? parseQuantityToken(match[1]!) : null;
  return match && quantity !== null ? { quantity, rangeNote: `${match[1]}-${match[2]}` } : null;
};

/** Words that, right after "no", make it the English "no" ("no salt added", "no sugar") rather than the count abbreviation "no."/"nos". */
const NO_MODIFIER_WORDS = new Set(['salt', 'added', 'sugar', 'fat', 'sodium', 'free', 'low', 'reduced', 'preservative', 'preservatives', 'oil', 'dairy', 'gluten', 'seeds', 'skin', 'bone', 'stock', 'cream']);
const COUNT_ABBREVIATION_PATTERN = /^nos?\.?$/i;

/** Consumes a single leading word from `text` if it is a recognised unit spelling (gms, tablespoons, pcs, ...), see `ingredientNormalisation/units.ts`. Called only directly after a numeric quantity. */
const consumeUnit = (text: string): { unit: string | null; rest: string } => {
  const match = /^\s*(\S+)\s*/.exec(text);
  if (!match) {
    return { unit: null, rest: text };
  }
  const word = match[1]!;
  if (COUNT_ABBREVIATION_PATTERN.test(word)) {
    const nextWord = /^\s*([^\s.,;]+)/.exec(text.slice(match[0].length))?.[1]?.toLowerCase();
    const isCount = nextWord !== undefined && !NO_MODIFIER_WORDS.has(nextWord);
    return isCount ? { unit: 'piece', rest: text.slice(match[0].length) } : { unit: null, rest: text };
  }
  const unit = canonicaliseUnit(word);
  return unit === null ? { unit: null, rest: text } : { unit, rest: text.slice(match[0].length) };
};

/** A size marker right after the quantity: an inch mark (`1"`) or `-inch`/` inch`. Returned as a note so "1\" piece of cinnamon" keeps its size. */
const INCH_MARKER_PATTERN = /^\s*(?:["\u201d\u2033]|-?\s*inch(?:es)?\b)\s*/i;

const consumeSizeMarker = (text: string, quantity: number | null): { sizeNote: string | null; rest: string } => {
  const match = INCH_MARKER_PATTERN.exec(text);
  if (!match || quantity === null) {
    return { sizeNote: null, rest: text };
  }
  return { sizeNote: `${quantity} inch`, rest: text.slice(match[0].length) };
};

/** Splits the remainder after quantity/unit into a name and optional notes — a trailing "(...)" parenthetical or a comma-separated suffix, e.g. "White Urad Dal (Whole)" or "atta, sifted". */
const extractNameAndNotes = (text: string): { name: string; notes: string | null } => {
  const trimmed = text.trim();
  const parenMatch = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(trimmed);
  if (parenMatch) {
    return { name: parenMatch[1]!.trim(), notes: parenMatch[2]!.trim() };
  }
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex !== -1) {
    const notes = trimmed.slice(commaIndex + 1).trim();
    return { name: trimmed.slice(0, commaIndex).trim(), notes: notes === '' ? null : notes };
  }
  return { name: trimmed, notes: null };
};

/** "x 400 g" / "x 400g" right after a count: a multipack's per-pack size, kept as a note. */
const MULTIPACK_PATTERN = /^\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\.?\s+/;

const consumeMultipack = (text: string): { packNote: string | null; rest: string } => {
  const match = MULTIPACK_PATTERN.exec(text);
  const packUnit = match ? canonicaliseUnit(match[2]!) : null;
  return match && packUnit !== null ? { packNote: `${match[1]} ${packUnit}`, rest: text.slice(match[0].length) } : { packNote: null, rest: text };
};

const joinNotes = (parts: ReadonlyArray<string | null>): string | null => parts.filter((part): part is string => part !== null && part !== '').join(', ') || null;

/** Shared tail of parsing once the leading quantity (and optional range note) has been consumed. A unit word is only taken when a name remains after it, so "6 cloves" keeps "cloves" as the name. */
const parseAfterQuantity = (raw: string, afterQuantity: string, quantity: number | null, rangeNote: string | null): ParsedIngredient => {
  const { packNote, rest: afterPack } = consumeMultipack(afterQuantity);
  const { sizeNote, rest: afterSize } = consumeSizeMarker(afterPack, quantity);
  const consumed = consumeUnit(afterSize);
  const unitHasName = consumed.unit !== null && (packNote !== null || consumed.rest.replace(/^of\s+/i, '').trim() !== '');
  const unit = unitHasName ? consumed.unit : null;
  const rest = unitHasName ? consumed.rest.replace(/^of\s+/i, '') : afterSize;
  const { name, notes: extractedNotes } = extractNameAndNotes(rest);
  return { raw, name: name === '' ? raw : name, quantity, unit, notes: joinNotes([rangeNote, packNote, sizeNote, extractedNotes]) };
};

/** No real ingredient line is this long; longer input is truncated so every regex below runs on bounded text. */
const MAX_INGREDIENT_LINE_LENGTH = 1000;

/**
 * Parses a free-text ingredient line ("2 cups atta, sifted") into its
 * quantity/unit/name/notes parts. Never drops the line: a string with no
 * recognisable leading quantity still yields a draft ingredient carrying
 * `raw` and `name` (falling back to the whole trimmed string as the name),
 * with `quantity`/`unit`/`notes` all `null` — the JSON-LD equivalent of an
 * AI parse that can't fully structure a line, same "never discard the
 * source text" contract described on `ParsedIngredient.raw`.
 */
export const parseIngredientString = (raw: string): ParsedIngredient => {
  const trimmedRaw = raw.slice(0, MAX_INGREDIENT_LINE_LENGTH).trim();
  const workingText = normaliseUnicodeFractions(trimmedRaw);
  const rangeMatch = RANGE_PATTERN.exec(workingText);
  if (rangeMatch) {
    return parseAfterQuantity(trimmedRaw, workingText.slice(rangeMatch[0].length), parseQuantityToken(rangeMatch[1]!), `${rangeMatch[1]}-${rangeMatch[2]}`);
  }
  const quantityMatch = LEADING_QUANTITY_PATTERN.exec(workingText);
  if (!quantityMatch) {
    const { name, notes } = extractNameAndNotes(workingText);
    return { raw: trimmedRaw, name: name === '' ? trimmedRaw : name, quantity: null, unit: null, notes };
  }
  return parseAfterQuantity(trimmedRaw, workingText.slice(quantityMatch[0].length), parseQuantityToken(quantityMatch[1]!), null);
};
