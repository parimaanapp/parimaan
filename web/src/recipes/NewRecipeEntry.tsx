'use client';

import { useState } from 'react';
import { draftToFormValues } from './draftToFormValues';
import { FreeformPasteTab } from './FreeformPasteTab';
import { RecipeForm } from './RecipeForm';
import type { RecipeDraft, RecipeSourceAttribution } from './types';
import { UrlImportTab } from './UrlImportTab';
import { BLANK_RECIPE_FORM_VALUES } from './useRecipeFormState';

interface NewRecipeEntryProps {
  householdId: string;
}

type EntryMode = 'manual' | 'url' | 'freeform';

interface PendingDraft {
  draft: RecipeDraft;
  source: RecipeSourceAttribution;
}

/**
 * The create-flow entry point (W18 S5): a mode picker (manual / import
 * from a URL / paste freeform text) that, for the two AI-assisted modes,
 * never calls `createRecipe` with the raw draft — it hands the draft to
 * `RecipeForm` in review mode first, mirroring the mobile app's own
 * `RecipeDraftReviewScreen` → `RecipeFormScreen` hand-off (RED test 2).
 * Once a draft is ready, the mode tabs disappear — the user is already in
 * review, going "back" to re-fetch a second draft is out of this slice's
 * scope, same as mobile's own one-shot review flow.
 */
export function NewRecipeEntry({ householdId }: NewRecipeEntryProps) {
  const [mode, setMode] = useState<EntryMode>('manual');
  const [pending, setPending] = useState<PendingDraft | null>(null);

  if (pending) {
    return (
      <RecipeForm
        mode="create"
        householdId={householdId}
        initial={draftToFormValues(pending.draft)}
        source={pending.source}
      />
    );
  }

  return (
    <div>
      <ModeTabs mode={mode} onChange={setMode} />
      {mode === 'manual' && (
        <RecipeForm mode="create" householdId={householdId} initial={BLANK_RECIPE_FORM_VALUES} />
      )}
      {mode === 'url' && (
        <UrlImportTab
          onDraftReady={(draft) =>
            setPending({ draft, source: { sourceType: 'url', sourceUrl: draft.sourceUrl ?? null } })
          }
        />
      )}
      {mode === 'freeform' && (
        <FreeformPasteTab onDraftReady={(draft) => setPending({ draft, source: { sourceType: 'freeform_ai' } })} />
      )}
    </div>
  );
}

interface ModeTabsProps {
  mode: EntryMode;
  onChange: (mode: EntryMode) => void;
}

function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <div role="tablist">
      <button type="button" aria-pressed={mode === 'manual'} onClick={() => onChange('manual')}>
        Enter manually
      </button>
      <button type="button" aria-pressed={mode === 'url'} onClick={() => onChange('url')}>
        Import from URL
      </button>
      <button type="button" aria-pressed={mode === 'freeform'} onClick={() => onChange('freeform')}>
        Paste text
      </button>
    </div>
  );
}
