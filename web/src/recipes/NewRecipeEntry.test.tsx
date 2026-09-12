// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const createExecute = vi.fn();
const importExecute = vi.fn();
const parseExecute = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('urql', () => ({
  useMutation: (document: string) => {
    if (document.includes('CreateRecipe')) return [{ fetching: false, error: undefined }, createExecute];
    if (document.includes('ImportRecipeFromUrl')) return [{ fetching: false, error: undefined }, importExecute];
    if (document.includes('ParseFreeformRecipe')) return [{ fetching: false, error: undefined }, parseExecute];
    if (document.includes('UpdateRecipe')) return [{ fetching: false, error: undefined }, vi.fn()];
    throw new Error(`unexpected mutation document in test: ${document}`);
  },
}));

const { NewRecipeEntry } = await import('./NewRecipeEntry');

const draft = {
  title: 'Imported Dal',
  description: null,
  servings: 4,
  prepMin: null,
  cookMin: null,
  cuisineTier1: null,
  cuisineTier2: null,
  dietaryTags: [],
  role: null,
  ingredients: [],
  steps: ['Cook'],
  sourceUrl: 'https://example.com/recipe',
  warnings: [],
};

beforeEach(() => {
  createExecute.mockReset();
  createExecute.mockResolvedValue({ data: { createRecipe: { id: 'r-new' } }, error: undefined });
  importExecute.mockReset();
  parseExecute.mockReset();
  push.mockReset();
});

describe('NewRecipeEntry — URL import draft review', () => {
  // RED test 2: a URL-import draft is shown for review/edit BEFORE any
  // createRecipe call fires — no path calls createRecipe directly off the
  // raw importRecipeFromUrl response.
  it('shows the fetched draft in an editable review form without calling createRecipe', async () => {
    importExecute.mockResolvedValue({ data: { importRecipeFromUrl: draft }, error: undefined });

    render(<NewRecipeEntry householdId="h1" />);

    fireEvent.click(screen.getByRole('button', { name: /import from url/i }));
    fireEvent.change(screen.getByLabelText('Recipe URL'), {
      target: { value: 'https://example.com/recipe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch recipe' }));

    const titleInput = await screen.findByLabelText('Title');
    expect(titleInput).toHaveValue('Imported Dal');
    expect(createExecute).not.toHaveBeenCalled();

    // The user must still affirmatively pick a role — the draft's own
    // null role never silently satisfies "role assignment required".
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'sabzi_dal' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(createExecute).toHaveBeenCalledTimes(1);
    expect(createExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        source: { sourceType: 'url', sourceUrl: 'https://example.com/recipe' },
      }),
    );
  });
});

describe('NewRecipeEntry — freeform paste draft review', () => {
  it('shows the parsed draft in review before createRecipe, with freeform_ai attribution', async () => {
    parseExecute.mockResolvedValue({ data: { parseFreeformRecipe: { ...draft, sourceUrl: null } }, error: undefined });

    render(<NewRecipeEntry householdId="h1" />);

    fireEvent.click(screen.getByRole('button', { name: /paste text/i }));
    fireEvent.change(screen.getByLabelText('Pasted recipe text'), {
      target: { value: 'Dal recipe text...' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Parse recipe' }));

    await screen.findByLabelText('Title');
    expect(createExecute).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'sabzi_dal' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(createExecute).toHaveBeenCalledWith(
      expect.objectContaining({ source: { sourceType: 'freeform_ai', sourceUrl: undefined } }),
    );
  });
});

describe('NewRecipeEntry — manual entry', () => {
  it('renders a blank form with no source attribution when creating manually', () => {
    render(<NewRecipeEntry householdId="h1" />);

    expect(screen.getByLabelText('Title')).toHaveValue('');
  });
});
