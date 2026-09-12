/**
 * The single piece of logic this whole slice exists to get right (per the
 * plan's own RED tests 1-2): builds a patch object containing ONLY the keys
 * whose value actually changed between `pristine` (what the server last
 * confirmed) and `current` (the form's live state) — every unchanged key is
 * genuinely absent from the returned object, never present with a value
 * that merely happens to match the server's own. A deep-equality check
 * (`JSON.stringify`) rather than `===` because `current`/`pristine` hold
 * fresh arrays/objects built fresh on every render, not the same reference
 * even when logically unchanged.
 */
export const buildSettingsPatch = <T extends object>(
  pristine: T,
  current: T,
  keys: readonly (keyof T)[],
): Partial<T> => {
  const patch: Partial<T> = {};
  for (const key of keys) {
    if (JSON.stringify(pristine[key]) !== JSON.stringify(current[key])) {
      patch[key] = current[key];
    }
  }
  return patch;
};
