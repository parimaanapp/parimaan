'use client';

import { CUISINE_TIER1_LABELS, CUISINE_TIER1_OPTIONS, type CuisineTier1 } from './domain';

interface CuisineRegionsFieldsetProps {
  selected: CuisineTier1[];
  onToggle: (region: CuisineTier1, selected: boolean) => void;
}

export function CuisineRegionsFieldset({ selected, onToggle }: CuisineRegionsFieldsetProps) {
  return (
    <fieldset>
      <legend>Regions</legend>
      {CUISINE_TIER1_OPTIONS.map((region) => (
        <label key={region}>
          <input
            type="checkbox"
            checked={selected.includes(region)}
            onChange={(event) => onToggle(region, event.target.checked)}
            aria-label={CUISINE_TIER1_LABELS[region]}
          />
          {CUISINE_TIER1_LABELS[region]}
        </label>
      ))}
    </fieldset>
  );
}
