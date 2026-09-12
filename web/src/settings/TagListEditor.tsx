'use client';

import { useState } from 'react';

interface TagListEditorProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  addButtonLabel: string;
}

/**
 * A small free-text list editor for `allergens`/`skipIngredients` — both
 * open, server-unvalidated-against-an-enum string lists (unlike
 * `dietaryTags`, which is a closed enum with its own checkbox UI below).
 */
export function TagListEditor({ label, tags, onChange, addButtonLabel }: TagListEditorProps) {
  const [draft, setDraft] = useState('');

  const addTag = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || tags.includes(trimmed)) {
      return;
    }
    onChange([...tags, trimmed]);
    setDraft('');
  };

  const removeTag = (tag: string) => onChange(tags.filter((existing) => existing !== tag));

  return (
    <fieldset>
      <legend>{label}</legend>
      <ul>
        {tags.map((tag) => (
          <li key={tag}>
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={`Add ${label.toLowerCase()}`}
      />
      <button type="button" onClick={addTag}>
        {addButtonLabel}
      </button>
    </fieldset>
  );
}
