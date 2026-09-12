'use client';

import type { CombinedError } from 'urql';

interface SectionSaveControlsProps {
  onSave: () => void;
  isDirty: boolean;
  fetching: boolean;
  error: CombinedError | undefined;
  saved: boolean;
}

/**
 * Shared save button + inline status for each independently-submittable
 * settings section (RED test 4 — "a server-side validation error renders
 * inline, never a silent no-op"). Disabled while nothing in this section
 * has changed, so an accidental click never sends an empty/no-op patch.
 */
export function SectionSaveControls({ onSave, isDirty, fetching, error, saved }: SectionSaveControlsProps) {
  return (
    <div>
      <button type="button" onClick={onSave} disabled={!isDirty || fetching}>
        {fetching ? 'Saving…' : 'Save'}
      </button>
      {error ? <p role="alert">Error: {error.message}</p> : null}
      {!error && saved ? <p role="status">Saved.</p> : null}
    </div>
  );
}
