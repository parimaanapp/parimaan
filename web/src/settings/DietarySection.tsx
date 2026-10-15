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

const EATING_STYLES: readonly DietaryTag[] = ['veg', 'non_veg', 'vegan', 'eggetarian', 'jain'];

const buildPatch =(pristine: FormState, current: FormState) =>
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

  // M3: a household needs an eating style; modifiers alone are rejected by the API.
  const hasStyle = current.dietaryTags.some((tag) => EATING_STYLES.includes(tag));

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
      {hasStyle ? null : <p role="alert">Select at least one eating style (Vegetarian, Non-vegetarian, Vegan, Egg friendly or Jain).</p>}
      <SectionSaveControls onSave={save} isDirty={isDirty && hasStyle} fetching={fetching} error={error} saved={saved} />
    </section>
  );
}
