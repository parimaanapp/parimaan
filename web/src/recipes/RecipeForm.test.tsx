// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const createExecute = vi.fn();
const updateExecute = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

// `urql`'s `useMutation` returns `[state, execute]`; this mock lets each
// test control which mutation document gets which mock by matching the
// document string, mirroring how the real hook is keyed per-document.
vi.mock('urql', () => ({
  useMutation: (document: string) => {
    if (document.includes('CreateRecipe')) {
      return [{ fetching: false, error: undefined }, createExecute];
    }
    if (document.includes('UpdateRecipe')) {
      return [{ fetching: false, error: undefined }, updateExecute];
    }
    throw new Error(`unexpected mutation document in test: ${document}`);
  },
}));

const { RecipeForm } = await import('./RecipeForm');
const { BLANK_RECIPE_FORM_VALUES } = await import('./useRecipeFormState');

beforeEach(() => {
  createExecute.mockReset();
  updateExecute.mockReset();
  push.mockReset();
});

describe('RecipeForm — create', () => {
  // RED test 1: create round-trips against the real mutation shape.
  it('calls createRecipe with householdId, a RecipeInput input, and no source by default', async () => {
    createExecute.mockResolvedValue({
      data: { createRecipe: { id: 'r9' } },
      error: undefined,
    });

    render(<RecipeForm mode="create" householdId="h1" initial={BLANK_RECIPE_FORM_VALUES} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dal Tadka' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'sabzi_dal' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(createExecute).toHaveBeenCalledWith({
      householdId: 'h1',
      input: {
        title: 'Dal Tadka',
        description: null,
        servings: null,
        prepMin: null,
        cookMin: null,
        cuisineTier1: null,
        cuisineTier2: null,
        dietaryTags: [],
        role: 'sabzi_dal',
        ingredients: [],
        steps: [],
      },
      source: undefined,
    });
  });

  it('passes the review-confirmed source attribution when creating from a draft', () => {
    createExecute.mockResolvedValue({ data: { createRecipe: { id: 'r9' } }, error: undefined });

    render(
      <RecipeForm
        mode="create"
        householdId="h1"
        initial={{ ...BLANK_RECIPE_FORM_VALUES, title: 'Imported', role: 'carb' }}
        source={{ sourceType: 'url', sourceUrl: 'https://example.com/recipe' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(createExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { sourceType: 'url', sourceUrl: 'https://example.com/recipe' },
      }),
    );
  });

  // RED test 4: a server-side validation error renders inline, never a
  // silent no-op.
  it('renders a server validation error inline instead of silently failing', async () => {
    createExecute.mockResolvedValue({
      data: undefined,
      error: { message: '[GraphQL] role assignment is required' },
    });

    render(
      <RecipeForm
        mode="create"
        householdId="h1"
        initial={{ ...BLANK_RECIPE_FORM_VALUES, title: 'Dal', role: 'sabzi_dal' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/role assignment is required/i);
  });
});

describe('RecipeForm — edit', () => {
  const initialRecipe = {
    id: 'r1',
    householdId: 'h1',
    sourceType: 'user' as const,
    sourceUrl: null,
    title: 'Dal',
    description: null,
    servings: 4,
    prepMin: null,
    cookMin: null,
    cuisineTier1: null,
    cuisineTier2: null,
    dietaryTags: [],
    role: 'sabzi_dal' as const,
    inRotation: false,
    isFavorite: false,
    ingredients: [],
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // RED test 3 (end-to-end through the component): only the field the user
  // actually touched is sent as the patch.
  it('sends only the changed field to updateRecipe', async () => {
    updateExecute.mockResolvedValue({ data: { updateRecipe: { id: 'r1' } }, error: undefined });

    render(
      <RecipeForm
        mode="edit"
        recipeId="r1"
        initialRecipe={initialRecipe}
        initial={{
          title: 'Dal',
          description: '',
          servings: 4,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: '',
          dietaryTags: [],
          role: 'sabzi_dal',
          ingredients: [],
          steps: [],
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dal Tadka' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(updateExecute).toHaveBeenCalledWith({ id: 'r1', input: { title: 'Dal Tadka' } });
  });
});
