'use client';

import type { DietaryTag } from './types';
import { DIETARY_TAG_VALUES } from './types';

interface DietaryTagsFieldsetProps {
  selected: DietaryTag[];
  onChange: (tags: DietaryTag[]) => void;
}

const toggleTag = (tags: DietaryTag[], tag: DietaryTag): DietaryTag[] =>
  tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];

/** The dietary-tag checkbox group — split out of `RecipeFormFields` so that component stays under this codebase's `max-lines-per-function` budget. */
export function DietaryTagsFieldset({ selected, onChange }: DietaryTagsFieldsetProps) {
  return (
    <fieldset>
      <legend>Dietary tags</legend>
      {DIETARY_TAG_VALUES.map((tag) => (
        <label key={tag}>
          <input type="checkbox" checked={selected.includes(tag)} onChange={() => onChange(toggleTag(selected, tag))} />
          {tag}
        </label>
      ))}
    </fieldset>
  );
}
