'use client';

import { CUISINE_BIAS_LABELS, CUISINE_BIAS_OPTIONS, type CuisineBias, type SubCuisine } from './domain';
import type { CuisineTier2WeightsMap } from './types';

interface CuisineSubBiasFieldsetProps {
  subCuisines: SubCuisine[];
  weights: CuisineTier2WeightsMap;
  onChange: (subCuisineKey: string, bias: CuisineBias) => void;
}

/** Renders nothing when `subCuisines` is empty — the selected regions have no documented Tier 2 (`domain.ts`'s own `SUB_CUISINE_TAXONOMY`). */
export function CuisineSubBiasFieldset({ subCuisines, weights, onChange }: CuisineSubBiasFieldsetProps) {
  if (subCuisines.length === 0) {
    return null;
  }
  return (
    <fieldset>
      <legend>Sub-cuisine bias</legend>
      {subCuisines.map((sub) => (
        <label key={sub.key}>
          {sub.label}
          <select
            value={weights[sub.key] ?? 'normal'}
            onChange={(event) => onChange(sub.key, event.target.value as CuisineBias)}
            aria-label={`${sub.label} bias`}
          >
            {CUISINE_BIAS_OPTIONS.map((bias) => (
              <option key={bias} value={bias}>
                {CUISINE_BIAS_LABELS[bias]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}
