import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { createServerUrqlClient } from '@/graphql/serverClient';
import { resolveHouseholdId } from '@/household/resolveHousehold';
import { buildRecipesQueryVariables } from '@/recipes/buildRecipesQueryVariables';
import { RECIPES_QUERY, type RecipesQueryResult } from '@/recipes/recipeQueries';
import { RECIPE_ROLES, type RecipeRole } from '@/recipes/types';

// Household-resolution + the query itself both depend on the caller's own
// session; never statically prerendered, same reasoning as every other
// authenticated page in this app (`app/me/page.tsx`'s identical comment).
export const dynamic = 'force-dynamic';

interface RecipesPageProps {
  searchParams: Promise<{ role?: string }>;
}

const parseRoleFilter = (role: string | undefined): RecipeRole | null =>
  role && RECIPE_ROLES.includes(role as RecipeRole) ? (role as RecipeRole) : null;

/**
 * W18 S5's list screen. Resolves the active household (D3) and renders
 * `Query.recipes` filtered by an optional `?role=` search param — an
 * honest, independent empty state for "no household yet" vs. "no recipes
 * for this filter yet" (never one blanket message for both).
 */
export default async function RecipesPage({ searchParams }: RecipesPageProps) {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/recipes');

  const client = createServerUrqlClient(idToken);
  const householdId = await resolveHouseholdId(client);

  if (!householdId) {
    return (
      <main>
        <h1>Recipes</h1>
        <p>You don&apos;t belong to a household yet.</p>
      </main>
    );
  }

  const { role } = await searchParams;
  const selectedRole = parseRoleFilter(role);
  const variables = buildRecipesQueryVariables(householdId, selectedRole);
  const result = await client.query<RecipesQueryResult>(RECIPES_QUERY, variables).toPromise();

  return (
    <main>
      <h1>Recipes</h1>
      <RoleFilterLinks selectedRole={selectedRole} />
      <p>
        <Link href="/recipes/new">New recipe</Link>
      </p>
      {result.error ? (
        <p role="alert">Error: {result.error.message}</p>
      ) : (
        <RecipeListOrEmptyState recipes={result.data?.recipes ?? []} selectedRole={selectedRole} />
      )}
    </main>
  );
}

function RoleFilterLinks({ selectedRole }: { selectedRole: RecipeRole | null }) {
  return (
    <nav aria-label="Filter by role">
      <Link href="/recipes" aria-current={selectedRole === null}>
        All
      </Link>
      {RECIPE_ROLES.map((role) => (
        <Link key={role} href={`/recipes?role=${role}`} aria-current={role === selectedRole}>
          {role}
        </Link>
      ))}
    </nav>
  );
}

function RecipeListOrEmptyState({
  recipes,
  selectedRole,
}: {
  recipes: RecipesQueryResult['recipes'];
  selectedRole: RecipeRole | null;
}) {
  if (recipes.length === 0) {
    return <p>No recipes yet{selectedRole ? ` for ${selectedRole}` : ''}.</p>;
  }

  return (
    <ul>
      {recipes.map((recipe) => (
        <li key={recipe.id}>
          <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link> ({recipe.role})
        </li>
      ))}
    </ul>
  );
}
