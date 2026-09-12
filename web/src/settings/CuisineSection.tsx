'use client';

import { buildSettingsPatch } from './buildSettingsPatch';
import { CuisineRegionsFieldset } from './CuisineRegionsFieldset';
import { CuisineSubBiasFieldset } from './CuisineSubBiasFieldset';
import { decodeCuisineTier2Weights, encodeCuisineTier2Weights } from './cuisineTier2WeightsCodec';
import { subCuisinesForRegions, type CuisineBias, type CuisineTier1 } from './domain';
import { SectionSaveControls } from './SectionSaveControls';
import type { CuisineTier2WeightsMap } from './types';
import { usePatchableSection } from './usePatchableSection';

interface CuisineSectionProps {
  householdId: string;
  initialCuisineTier1: CuisineTier1[];
  initialCuisineTier2Weights: string;
}

interface FormState {
  cuisineTier1: CuisineTier1[];
  tier2WeightsMap: CuisineTier2WeightsMap;
}

const buildPatch = (pristine: FormState, current: FormState) =>
  buildSettingsPatch(
    {
      cuisineTier1: pristine.cuisineTier1,
      cuisineTier2Weights: encodeCuisineTier2Weights(pristine.tier2WeightsMap),
    },
    {
      cuisineTier1: current.cuisineTier1,
      cuisineTier2Weights: encodeCuisineTier2Weights(current.tier2WeightsMap),
    },
    ['cuisineTier1', 'cuisineTier2Weights'],
  );

/** Owns `cuisineTier1` and `cuisineTier2Weights` — see `MealStructureSection`'s identical per-section-ownership doc comment. */
export function CuisineSection({ householdId, initialCuisineTier1, initialCuisineTier2Weights }: CuisineSectionProps) {
  const initial: FormState = {
    cuisineTier1: initialCuisineTier1,
    tier2WeightsMap: decodeCuisineTier2Weights(initialCuisineTier2Weights),
  };
  const { current, update, isDirty, saved, fetching, error, save } = usePatchableSection(
    householdId,
    initial,
    buildPatch,
  );

  const toggleRegion = (region: CuisineTier1, selected: boolean) =>
    update((prev) => ({
      ...prev,
      cuisineTier1: selected ? [...prev.cuisineTier1, region] : prev.cuisineTier1.filter((r) => r !== region),
    }));

  const setBias = (subCuisineKey: string, bias: CuisineBias) =>
    update((prev) => ({ ...prev, tier2WeightsMap: { ...prev.tier2WeightsMap, [subCuisineKey]: bias } }));

  return (
    <section aria-label="Cuisine">
      <h2>Cuisine</h2>
      <CuisineRegionsFieldset selected={current.cuisineTier1} onToggle={toggleRegion} />
      <CuisineSubBiasFieldset
        subCuisines={subCuisinesForRegions(current.cuisineTier1)}
        weights={current.tier2WeightsMap}
        onChange={setBias}
      />
      <SectionSaveControls onSave={save} isDirty={isDirty} fetching={fetching} error={error} saved={saved} />
    </section>
  );
}
