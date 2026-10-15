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

const sameTags = (a: readonly DietaryTag[], b: readonly DietaryTag[]): boolean =>
  a.length === b.length && a.every((tag) => b.includes(tag));

const EATING_STYLES: readonly DietaryTag[] = ['veg', 'non_veg', 'vegan', 'eggetarian', 'jain'];

const withTagToggled = (prev: FormState, tag: DietaryTag, selected: boolean): FormState => ({
  ...prev,
  dietaryTags: selected ? [...prev.dietaryTags, tag] : prev.dietaryTags.filter((t) => t !== tag),
});

// M3/F5: editing the tags must leave an eating style selected. A legacy
// household with no style is left alone until its tags are touched, so it
// can still save allergens and skip-ingredients.
const hasEatingStyle = (current: readonly DietaryTag[], initial: readonly DietaryTag[]): boolean =>
  sameTags(current, initial) || current.some((tag) => EATING_STYLES.includes(tag));

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

  const toggleTag = (tag: DietaryTag, selected: boolean) => update((prev) => withTagToggled(prev, tag, selected));
  const hasStyle = hasEatingStyle(current.dietaryTags, initialDietaryTags);

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
      {hasStyle ? null : (
        <p role="alert">Select at least one eating style (Vegetarian, Non-vegetarian, Vegan, Egg friendly or Jain).</p>
      )}
      <SectionSaveControls
        onSave={save}
        isDirty={isDirty && hasStyle}
        fetching={fetching}
        error={error}
        saved={saved}
      />
    </section>
  );
}
