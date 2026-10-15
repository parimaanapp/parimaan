'use client';

import { DIETARY_TAG_LABELS } from '../settings/domain';
import type { DietaryTag } from './types';
import { DIETARY_TAG_VALUES } from './types';

interface DietaryTagsFieldsetProps {
  selected: DietaryTag[];
  onChange: (tags: DietaryTag[]) => void;
}

/** `non_veg` contradicts these; the API rejects the combination (M2), so the form never produces it. */
const MEAT_FREE_STYLES: readonly DietaryTag[] = ['veg', 'vegan', 'jain'];

const toggleTag = (tags: DietaryTag[], tag: DietaryTag): DietaryTag[] => {
  if (tags.includes(tag)) {
    return tags.filter((t) => t !== tag);
  }
  if (tag === 'non_veg') {
    return [...tags.filter((t) => !MEAT_FREE_STYLES.includes(t)), tag];
  }
  if (MEAT_FREE_STYLES.includes(tag)) {
    return [...tags.filter((t) => t !== 'non_veg'), tag];
  }
  return [...tags, tag];
};

/** The dietary-tag checkbox group — split out of `RecipeFormFields` so that component stays under this codebase's `max-lines-per-function` budget. */
export function DietaryTagsFieldset({ selected, onChange }: DietaryTagsFieldsetProps) {
  return (
    <fieldset>
      <legend>Dietary tags</legend>
      {DIETARY_TAG_VALUES.map((tag) => (
        <label key={tag}>
          <input type="checkbox" checked={selected.includes(tag)} onChange={() => onChange(toggleTag(selected, tag))} />
          {DIETARY_TAG_LABELS[tag]}
        </label>
      ))}
    </fieldset>
  );
}
