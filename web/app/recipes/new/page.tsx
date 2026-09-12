import { getServerSession } from 'next-auth';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { createServerUrqlClient } from '@/graphql/serverClient';
import { resolveHouseholdId } from '@/household/resolveHousehold';
import { NewRecipeEntry } from '@/recipes/NewRecipeEntry';

export const dynamic = 'force-dynamic';

/**
 * W18 S5's create-entry screen: resolves the active household server-side
 * (auth-gated, D3), then hands off to the client `NewRecipeEntry` — manual
 * entry, URL import, or freeform paste, all landing on `RecipeForm` before
 * any `createRecipe` call (RED test 2).
 */
export default async function NewRecipePage() {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/recipes/new');

  const client = createServerUrqlClient(idToken);
  const householdId = await resolveHouseholdId(client);

  if (!householdId) {
    return (
      <main>
        <h1>New recipe</h1>
        <p>You don&apos;t belong to a household yet.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>New recipe</h1>
      <NewRecipeEntry householdId={householdId} />
    </main>
  );
}
