import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { createServerUrqlClient } from '@/graphql/serverClient';
import { resolveHouseholdId } from '@/household/resolveHousehold';
import { assertOwnHousehold } from '@/recipes/buildRecipesQueryVariables';
import { DeleteRecipeButton } from '@/recipes/DeleteRecipeButton';
import { RECIPE_QUERY, type RecipeQueryResult } from '@/recipes/recipeQueries';

export const dynamic = 'force-dynamic';

interface RecipeDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * W18 S5's detail screen — a read-only render of `Query.recipe(id)`, plus
 * the edit/delete entry points. `assertOwnHousehold` is defence-in-depth
 * on top of the resolver's own RLS (RED test 6): a recipe somehow
 * returned for a different household renders a 404, never the recipe.
 */
export default async function RecipeDetailPage({ params }: RecipeDetailPageProps) {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/recipes');
  const { id } = await params;

  const client = createServerUrqlClient(idToken);
  const householdId = await resolveHouseholdId(client);
  const result = await client.query<RecipeQueryResult>(RECIPE_QUERY, { id }).toPromise();

  if (result.error || !result.data) {
    notFound();
  }

  const recipe = result.data.recipe;
  if (!householdId) {
    notFound();
  }
  try {
    assertOwnHousehold(recipe, householdId);
  } catch {
    notFound();
  }

  return (
    <main>
      <h1>{recipe.title}</h1>
      <p>
        {recipe.role} · {recipe.servings} servings
        {recipe.prepMin !== null && ` · prep ${recipe.prepMin} min`}
        {recipe.cookMin !== null && ` · cook ${recipe.cookMin} min`}
      </p>
      {recipe.description && <p>{recipe.description}</p>}
      <h2>Ingredients</h2>
      <ul>
        {recipe.ingredients.map((ingredient) => (
          <li key={ingredient.id}>
            {[ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(' ')}
          </li>
        ))}
      </ul>
      <h2>Steps</h2>
      <ol>
        {recipe.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      <p>
        <Link href={`/recipes/${recipe.id}/edit`}>Edit recipe</Link>
      </p>
      <DeleteRecipeButton recipeId={recipe.id} recipeTitle={recipe.title} />
    </main>
  );
}
