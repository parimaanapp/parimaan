'use client';

import { useState } from 'react';
import type { HouseholdSettingsPatch } from './types';
import { useHouseholdSettingsMutation } from './useHouseholdSettingsMutation';

export interface PatchableSection<T> {
  current: T;
  /** Applies an immutable update to the section's own local form state. Marks any prior "Saved." status stale. */
  update: (updater: (prev: T) => T) => void;
  isDirty: boolean;
  saved: boolean;
  fetching: boolean;
  error: ReturnType<typeof useHouseholdSettingsMutation>['error'];
  save: () => Promise<void>;
}

/**
 * The pristine/current/save bookkeeping shared by all three settings
 * sections — factored out so each section component's own body is just
 * "decode props into form state, render controls," not a second copy of
 * this state machine (and to keep each component under this repo's
 * `max-lines-per-function` lint bound).
 *
 * `buildPatch` is what keeps each section's submission genuinely scoped: it
 * receives the section's own pristine/current form state and decides what,
 * if anything, actually changed — `DietarySection` diffs its state directly
 * (it already matches the wire shape); `MealStructureSection`/
 * `CuisineSection` first re-encode their decoded `AWSJSON` maps back to the
 * wire string before diffing, so a same-valued-but-differently-ordered
 * decode never reads as a spurious change.
 */
export function usePatchableSection<T>(
  householdId: string,
  initial: T,
  buildPatch: (pristine: T, current: T) => HouseholdSettingsPatch,
): PatchableSection<T> {
  const [pristine, setPristine] = useState(initial);
  const [current, setCurrent] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { submitPatch, fetching, error } = useHouseholdSettingsMutation();

  const update = (updater: (prev: T) => T) => {
    setSaved(false);
    setCurrent(updater);
  };

  const save = async () => {
    const patch = buildPatch(pristine, current);
    if (Object.keys(patch).length === 0) {
      return;
    }
    const ok = await submitPatch(householdId, patch);
    if (ok) {
      setPristine(current);
      setSaved(true);
    }
  };

  return {
    current,
    update,
    isDirty: JSON.stringify(pristine) !== JSON.stringify(current),
    saved,
    fetching,
    error,
    save,
  };
}
