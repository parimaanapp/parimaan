/**
 * Text hygiene shared by every recipe-import path (URL JSON-LD and
 * free-text paste): HTML entity decoding and whitespace normalisation.
 * Pure, never throws.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"',
  amp: '&',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  times: '×',
  eacute: 'é',
  egrave: 'è',
};

const ENTITY_PATTERN = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]*));/g;
const MAX_CODE_POINT = 0x10ffff;
/** Handles one level of double-encoding ("&amp;quot;") and no more, so decoding always terminates. */
const MAX_DECODE_PASSES = 2;

const decodeOnce = (input: string): string =>
  input.replace(ENTITY_PATTERN, (match, decimal?: string, hex?: string, named?: string) => {
    if (named !== undefined) {
      return NAMED_ENTITIES[named] ?? match;
    }
    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > MAX_CODE_POINT) {
      return match;
    }
    return String.fromCodePoint(codePoint);
  });

export const decodeHtmlEntities = (input: string): string => {
  let current = input;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodeOnce(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
};

/** Decodes entities, converts non-breaking spaces, collapses all whitespace runs to one space and trims. */
export const cleanText = (input: string): string =>
  decodeHtmlEntities(input)
    .replace(/[  ​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
