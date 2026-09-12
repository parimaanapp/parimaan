'use client';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small, generic Yes/No confirmation dialog — this codebase's web side
 * had no established confirm-dialog convention before this slice (checked:
 * `web/` has no prior UI beyond S3's proof-of-life pages), so this is a new
 * pattern, deliberately plain (`<dialog>`-less, no portal/overlay library)
 * rather than reaching for a new dependency for one use. Mirrors the
 * mobile app's own `delete_recipe_dialog.dart` shape: a title, a body
 * line, an inline error slot, Cancel/Confirm. A failed confirm leaves the
 * dialog open with the server's message visible, never auto-closes.
 */
export function ConfirmDialog({ title, body, confirmLabel, busy, error, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div role="alertdialog" aria-label={title}>
      <h2>{title}</h2>
      <p>{body}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button type="button" onClick={onConfirm} disabled={busy}>
        {confirmLabel}
      </button>
    </div>
  );
}
