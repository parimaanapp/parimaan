import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * H2 (PR #228 review) — forward-only DATA migration for the diet-matcher
 * (E2E_MVP_PLAN.md §32.3, `api/src/domain/dietMatch.ts`). Household copies of
 * the curated seeds were created before the seeds were retagged, and many
 * recipes carry no style tag at all, which makes them unreachable by every
 * household that has an eating style. Three idempotent statements:
 *
 *  1. The four meat/fish curated seeds gain `non_veg` (matched by title AND
 *     `source_type = 'curated'`, so a user's own recipe of the same name is
 *     never touched).
 *  2. Aloo Gobi and Jeera Aloo (curated) lose `jain` — they contain potato.
 *  3. Every recipe with no style tag gets one inferred from its title and
 *     ingredient names: meat/fish -> `non_veg`, egg -> `eggetarian`, else
 *     `veg`. The keyword lists are a frozen copy of the ones in
 *     `cookPreferenceFilter.ts` (a migration must not change meaning when the
 *     application code later does), matched as whole words with an optional
 *     plural; "-free" phrases are neutralised first ("egg-free mayo").
 *
 * Every statement is a no-op on a second run (the WHERE clauses exclude rows
 * already in the target state). There is no meaningful `down`: the previous
 * tag sets were wrong, not a state worth restoring.
 */
const NON_VEG_SEED_TITLES = [
  'Chicken Curry',
  'Butter Chicken',
  'Kerala Fish Curry (Meen Curry)',
  'Chettinad Chicken Curry',
];
const JAIN_FALSE_POSITIVE_TITLES = ['Aloo Gobi', 'Jeera Aloo'];

const quoteList = (values: readonly string[]): string => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

const MEAT_PATTERN = String.raw`\m(chicken|mutton|lamb|goat|beef|pork|bacon|ham|turkey|duck|lard|gelatin|gelatine|mince|keema|sausage|meat|fish|prawn|shrimp|crab|lobster|oyster|clam|mussel|squid|salmon|tuna|sardine|mackerel|anchov(y|ies)|rohu|pomfret|hilsa)(s|es)?\M`;
const EGG_PATTERN = String.raw`\m(egg|mayonnaise|mayo)(s|es)?\M`;
const HARMLESS_PATTERN = String.raw`[a-z]+-free( [a-z]+)?|(meat|egg|dairy|gluten)less( [a-z]+)?|goat(''s)? (cheese|milk)`;
const STYLE_TAGS = `ARRAY['veg','non_veg','vegan','eggetarian','jain']`;

export const RETAG_DIET_STYLES_SQL = `
  UPDATE recipes
  SET dietary_tags = (dietary_tags - 'veg' - 'vegan' - 'jain') || '["non_veg"]'::jsonb
  WHERE source_type = 'curated'
    AND title IN (${quoteList(NON_VEG_SEED_TITLES)})
    AND NOT (dietary_tags ? 'non_veg');

  UPDATE recipes
  SET dietary_tags = dietary_tags - 'jain'
  WHERE source_type = 'curated'
    AND title IN (${quoteList(JAIN_FALSE_POSITIVE_TITLES)})
    AND dietary_tags ? 'jain';

  WITH corpus AS (
    SELECT r.id,
           regexp_replace(
             lower(r.title || ' ' || COALESCE((SELECT string_agg(ri.name, ' ') FROM recipe_ingredients ri WHERE ri.recipe_id = r.id), '')),
             '${HARMLESS_PATTERN}', ' ', 'g'
           ) AS txt
    FROM recipes r
    WHERE NOT (r.dietary_tags ?| ${STYLE_TAGS})
  )
  UPDATE recipes r
  SET dietary_tags = r.dietary_tags || to_jsonb(
    CASE
      WHEN c.txt ~ '${MEAT_PATTERN}' THEN 'non_veg'
      WHEN c.txt ~ '${EGG_PATTERN}' THEN 'eggetarian'
      ELSE 'veg'
    END
  )
  FROM corpus c
  WHERE c.id = r.id;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(RETAG_DIET_STYLES_SQL);
}

export async function down(): Promise<void> {
  // Forward-only data fix: see the file header.
}
