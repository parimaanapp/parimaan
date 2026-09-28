/**
 * W21 — the parts of the cook-from-pantry prompt that other modules must agree
 * with: the limits the prompt promises the model, and how a household-typed name
 * is normalised on its way into the prompt. Lives in `domain/` (not `prompts/`)
 * so grounding can compare against exactly the text the model saw without the
 * domain layer importing a prompt module.
 */

/** What the prompt asks of the model. The grounding drop rule and the tests read these, so the prompt and its consumers cannot drift. */
export const PROMPT_LIMITS = { suggestions: 3, ingredients: 12, steps: 8, stepChars: 200, missing: 4, minPantryItems: 2 } as const;

/**
 * Prompt-size guard (D6). A backstop only: `selectPromptPantryItems` drops
 * staple categories first, so this alphabetical cut is reached only by a
 * pantry that is still over the limit after that. Names are the only pantry
 * content sent: no quantities, no expiry.
 */
export const MAX_PROMPT_PANTRY_ITEMS = 120;
export const MAX_PROMPT_NAME_LENGTH = 60;

/** Line and paragraph separators and every control character (incl. NEL): become a space so words do not fuse. */
const SEPARATORS_AND_CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/** Invisible formatting characters (zero-width, bidi overrides): removed outright, so "on<ZWSP>ion" is "onion". */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/**
 * Compatibility-normalise (fullwidth letters become plain), strip invisible
 * and separator characters, collapse whitespace, lowercase, cap by code point.
 * Lowercasing is what makes the prompt (and so the cache key) independent of
 * how a household happened to capitalise "Toor Dal"; capping by code point,
 * not UTF-16 unit, never splits an emoji into a lone surrogate.
 */
export const normalizeForPrompt = (raw: string): string =>
  Array.from(
    raw
      .normalize('NFKC')
      .replace(FORMAT_CHARACTERS, '')
      .replace(SEPARATORS_AND_CONTROLS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase(),
  )
    .slice(0, MAX_PROMPT_NAME_LENGTH)
    .join('')
    .trim();
