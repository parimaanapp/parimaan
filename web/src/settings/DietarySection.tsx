'use client';

import { buildSettingsPatch } from './buildSettingsPatch';
import { DietaryTagsFieldset } from './DietaryTagsFieldset';
import type { DietaryTag } from './domain';
import { SectionSaveControls } from './SectionSaveControls';
import { TagListEditor } from './TagListEditor';
import { usePatchableSection } from './usePatchableSection';

interface DietarySectionProps {
  householdId: string;
  initialDietaryTags: DietaryTag[];
  initialAllergens: string[];
  initialSkipIngredients: string[];
}

interface FormState {
  dietaryTags: DietaryTag[];
  allergens: string[];
  skipIngredients: string[];
}

const buildPatch = (pristine: FormState, current: FormState) =>
  buildSettingsPatch(pristine, current, ['dietaryTags', 'allergens', 'skipIngredients']);

/** Owns `dietaryTags`, `allergens`, and `skipIngredients` — see `MealStructureSection`'s identical per-section-ownership doc comment. */
export function DietarySection({
  householdId,
  initialDietaryTags,
  initialAllergens,
  initialSkipIngredients,
}: DietarySectionProps) {
  const initial: FormState = {
    dietaryTags: initialDietaryTags,
    allergens: initialAllergens,
    skipIngredients: initialSkipIngredients,
  };
  const { current, update, isDirty, saved, fetching, error, save } = usePatchableSection(
    householdId,
    initial,
    buildPatch,
  );

  const toggleTag = (tag: DietaryTag, selected: boolean) =>
    update((prev) => ({
      ...prev,
      dietaryTags: selected ? [...prev.dietaryTags, tag] : prev.dietaryTags.filter((t) => t !== tag),
    }));

  return (
    <section aria-label="Dietary and allergens">
      <h2>Dietary &amp; allergens</h2>
      <DietaryTagsFieldset selected={current.dietaryTags} onToggle={toggleTag} />
      <TagListEditor
        label="Allergens"
        tags={current.allergens}
        onChange={(allergens) => update((prev) => ({ ...prev, allergens }))}
        addButtonLabel="Add allergen"
      />
      <TagListEditor
        label="Ingredients to skip"
        tags={current.skipIngredients}
        onChange={(skipIngredients) => update((prev) => ({ ...prev, skipIngredients }))}
        addButtonLabel="Add ingredient"
      />
      <SectionSaveControls onSave={save} isDirty={isDirty} fetching={fetching} error={error} saved={saved} />
    </section>
  );
}
