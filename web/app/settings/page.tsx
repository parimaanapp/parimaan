import { getServerSession } from 'next-auth';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { HOUSEHOLD_SETTINGS_QUERY, type HouseholdSettingsQueryResult } from '@/graphql/queries';
import { resolveHouseholdId } from '@/graphql/resolveHouseholdId';
import { createServerUrqlClient } from '@/graphql/serverClient';
import { CuisineSection } from '@/settings/CuisineSection';
import type { CuisineTier1, DietaryTag, MealType } from '@/settings/domain';
import { DietarySection } from '@/settings/DietarySection';
import { MealStructureSection } from '@/settings/MealStructureSection';

// Same reasoning as `app/me/page.tsx` — this screen's data is per-user/
// per-household and must never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * W18 S6 — the household settings admin screen (D5's settings-edit half).
 * Server-rendered: resolve the session (redirect to sign-in if absent, RED
 * test 5) → resolve the caller's own household (D3, RED test 6) → fetch its
 * current settings once (RED test 3: the form is pre-populated with real
 * data) → hand each field group to its own independently-submittable client
 * section. Three sections, not one giant form, per this slice's own
 * documented choice (see each section's doc comment): a per-section "Save"
 * keeps every single submission's patch genuinely scoped to the fields that
 * section owns, which is what makes the partial-patch contract (RED tests
 * 1-2) straightforward to get right — a single form covering all seven
 * `HouseholdSettingsInput` fields would otherwise need to track "touched"
 * state across a much larger, unrelated set of controls to achieve the same
 * guarantee.
 */
export default async function SettingsPage() {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/settings');

  const householdId = await resolveHouseholdId(idToken);
  const client = createServerUrqlClient(idToken);
  const result = await client
    .query<HouseholdSettingsQueryResult>(HOUSEHOLD_SETTINGS_QUERY, { householdId })
    .toPromise();

  if (result.error || !result.data) {
    return (
      <main>
        <h1>Household settings</h1>
        <p role="alert">Error: {result.error?.message ?? 'Could not load settings.'}</p>
      </main>
    );
  }

  const { settings } = result.data.household;

  return (
    <main>
      <h1>Household settings</h1>
      <MealStructureSection
        householdId={householdId}
        initialMealsEnabled={settings.mealsEnabled as MealType[]}
        initialMealStructure={settings.mealStructure}
      />
      <CuisineSection
        householdId={householdId}
        initialCuisineTier1={settings.cuisineTier1 as CuisineTier1[]}
        initialCuisineTier2Weights={settings.cuisineTier2Weights}
      />
      <DietarySection
        householdId={householdId}
        initialDietaryTags={settings.dietaryTags as DietaryTag[]}
        initialAllergens={settings.allergens}
        initialSkipIngredients={settings.skipIngredients}
      />
    </main>
  );
}
