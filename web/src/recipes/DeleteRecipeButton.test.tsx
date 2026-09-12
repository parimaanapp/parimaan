// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const deleteExecute = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('urql', () => ({
  useMutation: () => [{ fetching: false, error: undefined }, deleteExecute],
}));

const { DeleteRecipeButton } = await import('./DeleteRecipeButton');

beforeEach(() => {
  deleteExecute.mockReset();
  push.mockReset();
});

describe('DeleteRecipeButton', () => {
  // RED test 5 (delete flow): a confirmation step happens before the
  // actual deleteRecipe call fires — the trigger button alone never
  // deletes anything.
  it('does not call deleteRecipe until the confirmation dialog is confirmed', () => {
    render(<DeleteRecipeButton recipeId="r1" recipeTitle="Dal" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));

    expect(deleteExecute).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('cancelling the dialog never calls deleteRecipe', () => {
    render(<DeleteRecipeButton recipeId="r1" recipeTitle="Dal" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteExecute).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // RED test 1: delete round-trips against the real mutation shape.
  it('calls deleteRecipe with the recipe id once confirmed, then navigates to the list', async () => {
    deleteExecute.mockResolvedValue({ data: { deleteRecipe: { id: 'r1' } }, error: undefined });

    render(<DeleteRecipeButton recipeId="r1" recipeTitle="Dal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteExecute).toHaveBeenCalledWith({ id: 'r1' });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/recipes'));
  });

  // RED test 4: a server error renders inline inside the dialog rather
  // than a silent no-op.
  it('shows the server error inline and keeps the dialog open on failure', async () => {
    deleteExecute.mockResolvedValue({ data: undefined, error: { message: 'cannot delete: in use' } });

    render(<DeleteRecipeButton recipeId="r1" recipeTitle="Dal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot delete: in use');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
