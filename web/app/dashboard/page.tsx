import { getServerSession } from 'next-auth';
import { MenuSection } from '@/components/dashboard/MenuSection';
import { PantrySection } from '@/components/dashboard/PantrySection';
import { ShoppingListSection } from '@/components/dashboard/ShoppingListSection';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { loadDashboardData } from '@/dashboard/loadDashboardData';
import { resolvePrimaryHouseholdId } from '@/dashboard/resolvePrimaryHousehold';
import { createServerUrqlClient } from '@/graphql/serverClient';

// Same reasoning as `app/me/page.tsx` — session-dependent, never statically
// prerendered.
export const dynamic = 'force-dynamic';

/**
 * W18 S4's dashboard screen (E2E_MVP_PLAN.md §24.3 S4): pantry + this
 * week's plan + shopping list, entirely read-only (D5 — no mutations, no
 * edit affordances, no "generate list" button; that stays mobile-only this
 * week). `requireIdToken` redirects to sign-in instead of rendering with no
 * data (RED test 5) — the identical gating `app/me/page.tsx` already
 * established in S3, reused here rather than re-invented.
 *
 * The household is always `resolvePrimaryHouseholdId`'s own resolved id
 * (D3: `me.households[0]`, no switcher) — every one of `loadDashboardData`'s
 * three queries is built from THAT id, never a client-suppliable one (RED
 * test 6): there is no route param, query string, or form field anywhere on
 * this page that could supply a different household id.
 */
export default async function DashboardPage() {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/dashboard');

  const client = createServerUrqlClient(idToken);
  const householdId = await resolvePrimaryHouseholdId(client);

  if (householdId === null) {
    return (
      <main>
        <h1>Dashboard</h1>
        <p data-testid="no-household-state">
          You don&apos;t belong to a household yet.
        </p>
      </main>
    );
  }

  const { pantry, menu, shoppingList } = await loadDashboardData(client, householdId);

  return (
    <main>
      <h1>Dashboard</h1>
      <PantrySection items={pantry} />
      <MenuSection menu={menu} />
      <ShoppingListSection shoppingList={shoppingList} />
    </main>
  );
}
