'use client';

import { DIETARY_TAG_LABELS, DIETARY_TAG_OPTIONS, type DietaryTag } from './domain';

interface DietaryTagsFieldsetProps {
  selected: DietaryTag[];
  onToggle: (tag: DietaryTag, selected: boolean) => void;
}

export function DietaryTagsFieldset({ selected, onToggle }: DietaryTagsFieldsetProps) {
  return (
    <fieldset>
      <legend>Dietary tags</legend>
      {DIETARY_TAG_OPTIONS.map((tag) => (
        <label key={tag}>
          <input
            type="checkbox"
            checked={selected.includes(tag)}
            onChange={(event) => onToggle(tag, event.target.checked)}
            aria-label={DIETARY_TAG_LABELS[tag]}
          />
          {DIETARY_TAG_LABELS[tag]}
        </label>
      ))}
    </fieldset>
  );
}
