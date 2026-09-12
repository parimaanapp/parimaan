'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { PARSE_FREEFORM_RECIPE_MUTATION, type ParseFreeformRecipeResult } from './recipeMutations';
import type { RecipeDraft } from './types';

interface FreeformPasteTabProps {
  onDraftReady: (draft: RecipeDraft) => void;
}

/**
 * Freeform-paste entry: parses pasted text via `parseFreeformRecipe` into
 * a `RecipeDraft` and hands it to the parent for review — same "never
 * auto-saves" contract as `UrlImportTab` (RED test 2).
 */
export function FreeformPasteTab({ onDraftReady }: FreeformPasteTabProps) {
  const [text, setText] = useState('');
  const [{ fetching, error }, parseFreeformRecipe] = useMutation<ParseFreeformRecipeResult>(
    PARSE_FREEFORM_RECIPE_MUTATION,
  );

  const parseDraft = async (): Promise<void> => {
    const result = await parseFreeformRecipe({ text });
    if (result.data?.parseFreeformRecipe) {
      onDraftReady(result.data.parseFreeformRecipe);
    }
  };

  return (
    <div>
      <label>
        Pasted recipe text
        <textarea aria-label="Pasted recipe text" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="button" disabled={fetching || !text} onClick={() => void parseDraft()}>
        Parse recipe
      </button>
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
