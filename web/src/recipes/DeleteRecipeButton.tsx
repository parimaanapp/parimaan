'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from 'urql';
import { ConfirmDialog } from './ConfirmDialog';
import { DELETE_RECIPE_MUTATION } from './recipeMutations';

interface DeleteRecipeButtonProps {
  recipeId: string;
  recipeTitle: string;
}

/**
 * The detail screen's delete flow: a plain button that opens
 * `ConfirmDialog` rather than calling `deleteRecipe` directly — RED test
 * 5's own "a confirmation step before the actual call fires." On success,
 * navigates back to the recipes list; on a server error, the dialog stays
 * open with the message visible (RED test 4), mirroring
 * `delete_recipe_dialog.dart`'s own "a failure keeps the dialog open."
 */
export function DeleteRecipeButton({ recipeId, recipeTitle }: DeleteRecipeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [{ fetching }, deleteRecipe] = useMutation(DELETE_RECIPE_MUTATION);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    const result = await deleteRecipe({ id: recipeId });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push('/recipes');
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Delete recipe
      </button>
    );
  }

  return (
    <ConfirmDialog
      title="Delete this recipe?"
      body={`"${recipeTitle}" will be removed from the library.`}
      confirmLabel="Delete"
      busy={fetching}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => setOpen(false)}
    />
  );
}
