import { KNOWN_PANTRY_UNITS } from './pantryUnits.js';

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
const NUMERIC_TOKEN_SOURCE = '\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?';
const LEADING_QUANTITY_PATTERN = new RegExp(`^\\s*(${NUMERIC_TOKEN_SOURCE})\\s*`);
const PURE_NUMERIC_TOKEN_PATTERN = new RegExp(`^(${NUMERIC_TOKEN_SOURCE})$`);

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
  return sanitizeQuantity(Number(token));
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
  const trimmed = text.trim();
  if (trimmed === '') {
    return { quantity: null, leftoverText: null };
  }
  if (!PURE_NUMERIC_TOKEN_PATTERN.test(trimmed)) {
    return { quantity: null, leftoverText: trimmed };
  }
  // A numeric-shaped token (e.g. "1/0", or a digit run past
  // `MAX_REASONABLE_QUANTITY`) that `parseQuantityToken` itself rejects
  // still preserves the original text as `leftoverText` rather than
  // silently losing it — the same "never drop the source text" contract
  // this module documents everywhere else.
  const quantity = parseQuantityToken(trimmed);
  return quantity === null ? { quantity: null, leftoverText: trimmed } : { quantity, leftoverText: null };
};

/** Consumes a single leading word from `text` if it matches a known pantry unit (singular or a simple trailing-`s` plural, e.g. "cups" → "cup"). */
const consumeUnit = (text: string): { unit: string | null; rest: string } => {
  const match = /^\s*(\S+)\s*/.exec(text);
  if (!match) {
    return { unit: null, rest: text };
  }
  const word = match[1]!.toLowerCase();
  const singular = word.endsWith('s') && word.length > 1 ? word.slice(0, -1) : word;
  const known = KNOWN_PANTRY_UNITS.find((unit) => unit === word || unit === singular);
  return known === undefined ? { unit: null, rest: text } : { unit: known, rest: text.slice(match[0].length) };
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
  const trimmedRaw = raw.trim();
  const quantityMatch = LEADING_QUANTITY_PATTERN.exec(trimmedRaw);
  if (!quantityMatch) {
    const { name, notes } = extractNameAndNotes(trimmedRaw);
    return { raw: trimmedRaw, name: name === '' ? trimmedRaw : name, quantity: null, unit: null, notes };
  }

  const quantity = parseQuantityToken(quantityMatch[1]!);
  const afterQuantity = trimmedRaw.slice(quantityMatch[0].length);
  const { unit, rest } = consumeUnit(afterQuantity);
  const { name, notes } = extractNameAndNotes(rest);
  return { raw: trimmedRaw, name: name === '' ? trimmedRaw : name, quantity, unit, notes };
};
