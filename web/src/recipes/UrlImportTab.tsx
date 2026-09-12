'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { IMPORT_RECIPE_FROM_URL_MUTATION, type ImportRecipeFromUrlResult } from './recipeMutations';
import type { RecipeDraft } from './types';

interface UrlImportTabProps {
  onDraftReady: (draft: RecipeDraft) => void;
}

/**
 * URL-import entry: fetches a `RecipeDraft` via `importRecipeFromUrl` and
 * hands it to the parent for review — never calls `createRecipe` itself
 * (RED test 2's own "a draft is shown for review before any createRecipe
 * call fires").
 */
export function UrlImportTab({ onDraftReady }: UrlImportTabProps) {
  const [url, setUrl] = useState('');
  const [{ fetching, error }, importRecipeFromUrl] = useMutation<ImportRecipeFromUrlResult>(
    IMPORT_RECIPE_FROM_URL_MUTATION,
  );

  const fetchDraft = async (): Promise<void> => {
    const result = await importRecipeFromUrl({ url });
    if (result.data?.importRecipeFromUrl) {
      onDraftReady(result.data.importRecipeFromUrl);
    }
  };

  return (
    <div>
      <label>
        Recipe URL
        <input aria-label="Recipe URL" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <button type="button" disabled={fetching || !url} onClick={() => void fetchDraft()}>
        Fetch recipe
      </button>
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
