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
const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

/** C0 and C1 control characters other than tab/LF/CR (which are whitespace). */
const isDisallowedControl = (codePoint: number): boolean =>
  (codePoint < 32 && codePoint !== TAB && codePoint !== LINE_FEED && codePoint !== CARRIAGE_RETURN) || (codePoint >= 127 && codePoint <= 159);

const isSurrogate = (codePoint: number): boolean => codePoint >= 0xd800 && codePoint <= 0xdfff;

const isDecodableCodePoint = (codePoint: number): boolean =>
  Number.isFinite(codePoint) && codePoint > 0 && codePoint <= MAX_CODE_POINT && !isSurrogate(codePoint) && !isDisallowedControl(codePoint);

/** Single pass on purpose: "&amp;quot;" decodes to "&quot;", never to a quote. */
export const decodeHtmlEntities = (input: string): string =>
  input.replace(ENTITY_PATTERN, (match, decimal?: string, hex?: string, named?: string) => {
    if (named !== undefined) {
      return NAMED_ENTITIES[named] ?? match;
    }
    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    return isDecodableCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
  });

const stripControlCharacters = (input: string): string => {
  let result = '';
  for (const char of input) {
    if (!isDisallowedControl(char.codePointAt(0) ?? 0)) {
      result += char;
    }
  }
  return result;
};

/** Decodes entities once, drops control characters, collapses whitespace runs (JS \s includes NBSP, tab, newline) to one space and trims. */
export const cleanText = (input: string): string => stripControlCharacters(decodeHtmlEntities(input)).replace(/\s+/g, ' ').trim();
