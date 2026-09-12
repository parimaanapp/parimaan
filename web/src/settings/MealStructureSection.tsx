'use client';

import { buildSettingsPatch } from './buildSettingsPatch';
import { MEAL_TYPES, type MealType } from './domain';
import { MealStructureRow } from './MealStructureRow';
import { decodeMealStructure, encodeMealStructure, entryFor } from './mealStructureCodec';
import { SectionSaveControls } from './SectionSaveControls';
import type { MealStructureEntry, MealStructureMap } from './types';
import { usePatchableSection } from './usePatchableSection';

interface MealStructureSectionProps {
  householdId: string;
  initialMealsEnabled: MealType[];
  initialMealStructure: string;
}

interface FormState {
  mealsEnabled: MealType[];
  mealStructureMap: MealStructureMap;
}

const buildPatch = (pristine: FormState, current: FormState) =>
  buildSettingsPatch(
    { mealsEnabled: pristine.mealsEnabled, mealStructure: encodeMealStructure(pristine.mealStructureMap) },
    { mealsEnabled: current.mealsEnabled, mealStructure: encodeMealStructure(current.mealStructureMap) },
    ['mealsEnabled', 'mealStructure'],
  );

/**
 * Owns exactly two `HouseholdSettingsInput` fields: `mealsEnabled` and
 * `mealStructure`. Submitting this section's "Save" only ever patches these
 * two — never `cuisineTier1`/`dietaryTags`/etc., which the other two
 * sections own and submit independently (this slice's own documented
 * choice: per-section "Save" buttons keep each submission's patch genuinely
 * scoped, per the plan's own "that's a reasonable, even preferable" note).
 * State bookkeeping (pristine/current/save) lives in `usePatchableSection`,
 * shared by all three sections.
 */
export function MealStructureSection({
  householdId,
  initialMealsEnabled,
  initialMealStructure,
}: MealStructureSectionProps) {
  const initial: FormState = { mealsEnabled: initialMealsEnabled, mealStructureMap: decodeMealStructure(initialMealStructure) };
  const { current, update, isDirty, saved, fetching, error, save } = usePatchableSection(
    householdId,
    initial,
    buildPatch,
  );

  const toggleMeal = (mealType: MealType, enabled: boolean) =>
    update((prev) => ({
      ...prev,
      mealsEnabled: enabled ? [...prev.mealsEnabled, mealType] : prev.mealsEnabled.filter((m) => m !== mealType),
    }));

  const changeEntry = (mealType: MealType) => (entry: MealStructureEntry) =>
    update((prev) => ({ ...prev, mealStructureMap: { ...prev.mealStructureMap, [mealType]: entry } }));

  return (
    <section aria-label="Meal structure">
      <h2>Meal structure</h2>
      {MEAL_TYPES.map((mealType) => (
        <MealStructureRow
          key={mealType}
          mealType={mealType}
          enabled={current.mealsEnabled.includes(mealType)}
          entry={entryFor(current.mealStructureMap, mealType)}
          onToggle={(enabled) => toggleMeal(mealType, enabled)}
          onEntryChange={changeEntry(mealType)}
        />
      ))}
      <SectionSaveControls onSave={save} isDirty={isDirty} fetching={fetching} error={error} saved={saved} />
    </section>
  );
}
