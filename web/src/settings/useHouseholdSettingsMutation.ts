'use client';

import type { CombinedError } from 'urql';
import { useMutation } from 'urql';
import {
  UPDATE_HOUSEHOLD_SETTINGS_MUTATION,
  type UpdateHouseholdSettingsMutationResult,
} from '@/graphql/queries';
import type { HouseholdSettingsPatch } from './types';

export interface HouseholdSettingsMutation {
  submitPatch: (householdId: string, input: HouseholdSettingsPatch) => Promise<boolean>;
  fetching: boolean;
  error: CombinedError | undefined;
}

/**
 * Thin wrapper around `useMutation` shared by all three settings sections —
 * each section builds its own, genuinely-partial `input` via
 * `buildSettingsPatch` and hands it here unchanged; this hook never adds,
 * removes, or defaults a field.
 */
export const useHouseholdSettingsMutation = (): HouseholdSettingsMutation => {
  const [result, executeMutation] = useMutation<UpdateHouseholdSettingsMutationResult>(
    UPDATE_HOUSEHOLD_SETTINGS_MUTATION,
  );

  const submitPatch = async (householdId: string, input: HouseholdSettingsPatch): Promise<boolean> => {
    const response = await executeMutation({ householdId, input });
    return !response.error;
  };

  return { submitPatch, fetching: result.fetching, error: result.error };
};
