/**
 * Matches only the time-of-day portion of an ISO-8601 duration (`PT1H30M`,
 * `PT45M`, `PT90S`) — the shape `prepTime`/`cookTime` always use in
 * practice. The `(?=\d)` lookahead requires at least one digit immediately
 * after `PT`, so a bare `"PT"` or a malformed value (S1's own
 * `kannammacooks` fixture has the garbage value `"PT-496636H14M2S"`, a
 * leading minus sign that breaks the digit-immediately-after-PT
 * requirement) both fail the match and fall through to `null` — a recipe
 * duration in days/months/years (`P3D`) is out of scope: nonsensical for a
 * recipe's prep/cook time and not observed in any of S1's 20 fixtures.
 */
const ISO_8601_TIME_DURATION_PATTERN = /^PT(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/;

/**
 * No real recipe's prep/cook time is measured in weeks — this is purely a
 * sanity ceiling against an adversarial digit run (e.g. `PT` + 400 nines +
 * `H`), which without a bound would otherwise satisfy `number | null` with
 * `Infinity`, silently violating this function's own "never a wrong or
 * nonsensical number" contract (caught by `typescript-reviewer` against
 * exactly this input).
 */
const MAX_REASONABLE_DURATION_MINUTES = 10_000;

/**
 * Converts an ISO-8601 time duration string to whole minutes, or `null`
 * for anything that isn't a well-formed one, non-finite, or implausibly
 * large — garbage in, `null` out, never a wrong or nonsensical number
 * (E2E_MVP_PLAN.md §13.3 S4).
 */
export const parseIsoDurationToMinutes = (value: unknown): number | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const match = ISO_8601_TIME_DURATION_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const totalMinutes = Math.round(hours * 60 + minutes + seconds / 60);
  return Number.isFinite(totalMinutes) && totalMinutes <= MAX_REASONABLE_DURATION_MINUTES ? totalMinutes : null;
};
