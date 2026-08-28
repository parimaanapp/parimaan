/** A number must be at the very start of the string to count — "4 servings" → 4, but "makes 12 laddoos" → null rather than the wrong number (the "12" isn't actually the *yield token*, it's embedded in a sentence a stricter reader would misparse). */
const LEADING_NUMBER_PATTERN = /^\s*(\d+)/;

/**
 * No real recipe serves this many people — a sanity ceiling against an
 * adversarial digit run in either the numeric or string branch below
 * (without one, `Number('9'.repeat(400))` satisfies `number | null` with
 * `Infinity`, the same class of bug `typescript-reviewer` flagged in
 * `duration.ts`).
 */
const MAX_REASONABLE_SERVINGS = 10_000;

/** A value passes only if finite, positive, and under `MAX_REASONABLE_SERVINGS` — applied identically whether `candidate` started as a JSON number or was parsed out of a string, so the two branches below can't silently drift apart on this check the way the numeric branch alone used to. */
const isSaneServings = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= MAX_REASONABLE_SERVINGS;

const parseYieldCandidate = (candidate: unknown): number | null => {
  if (typeof candidate === 'number') {
    return isSaneServings(candidate) ? Math.round(candidate) : null;
  }
  if (typeof candidate !== 'string') {
    return null;
  }
  const match = LEADING_NUMBER_PATTERN.exec(candidate);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return isSaneServings(parsed) ? parsed : null;
};

/**
 * Normalises `recipeYield` to a servings count. Handles every shape S1's 20
 * real fixtures produced: a bare number, a single string ("4 servings"),
 * and — the common real-world case the plan's own examples didn't
 * anticipate — an array of strings where the first entry is the clean
 * numeric form and the second is a descriptive duplicate (`["4","4
 * people"]`, `["25","25 pieces"]`). Tries each array entry in order and
 * returns the first one that parses.
 */
export const parseRecipeYield = (value: unknown): number | null => {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const parsed = parseYieldCandidate(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};
