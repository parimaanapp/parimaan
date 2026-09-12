import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { createServerUrqlClient } from '@/graphql/serverClient';
import { resolveHouseholdId } from '@/household/resolveHousehold';
import { assertOwnHousehold } from '@/recipes/buildRecipesQueryVariables';
import { RECIPE_QUERY, type RecipeQueryResult } from '@/recipes/recipeQueries';
import { RecipeForm } from '@/recipes/RecipeForm';
import { recipeToFormValues } from '@/recipes/recipeToFormValues';

export const dynamic = 'force-dynamic';

interface EditRecipePageProps {
  params: Promise<{ id: string }>;
}

/**
 * W18 S5's edit screen: loads the real `Recipe` server-side, then hands it
 * to the client `RecipeForm` in edit mode, which diffs against it via
 * `buildRecipePatch` on submit — a genuine partial patch, never a full
 * overwrite (RED test 3).
 */
export default async function EditRecipePage({ params }: EditRecipePageProps) {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/recipes');
  const { id } = await params;

  const client = createServerUrqlClient(idToken);
  const householdId = await resolveHouseholdId(client);
  const result = await client.query<RecipeQueryResult>(RECIPE_QUERY, { id }).toPromise();

  if (result.error || !result.data || !householdId) {
    notFound();
  }

  const recipe = result.data.recipe;
  try {
    assertOwnHousehold(recipe, householdId);
  } catch {
    notFound();
  }

  return (
    <main>
      <h1>Edit recipe</h1>
      <RecipeForm mode="edit" recipeId={recipe.id} initialRecipe={recipe} initial={recipeToFormValues(recipe)} />
    </main>
  );
}
