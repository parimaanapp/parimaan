import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * H2/F2-F7 (PR #228 review) — forward-only DATA migration for the
 * diet-matcher (E2E_MVP_PLAN.md §32.3, `api/src/domain/dietMatch.ts`).
 * Household copies of the curated seeds were created before the seeds were
 * retagged, and many recipes carry no style tag at all, which makes them
 * unreachable by every household that has an eating style. Idempotent
 * statements, in order:
 *
 *  1. The four meat/fish curated seeds gain `non_veg` (matched by title AND
 *     `source_type = 'curated'`, so a user's own recipe of the same name is
 *     never touched).
 *  2. Aloo Gobi and Jeera Aloo (curated) lose `jain` — they contain potato.
 *  3. Curated seeds that list ghee (Roti, Rasam, Jeera Rice, Plain Steamed
 *     Rice) lose `vegan` (they stay `veg`).
 *  4. Any recipe carrying `non_veg` together with veg/vegan/jain loses the
 *     latter (the combination is now rejected on write).
 *  5. Every recipe with no style tag gets one inferred from its title and
 *     ingredient names: meat/fish -> `non_veg`, egg -> `eggetarian`, else
 *     `veg`. The keyword lists are a frozen copy of the ones in
 *     `cookPreferenceFilter.ts` (a migration must not change meaning when the
 *     application code later does). Each title / ingredient name is cleaned
 *     and matched SEPARATELY, as whole words with an optional plural, so a
 *     "-free" marker can never swallow a word from the next ingredient.
 *     "egg-free mayo" / "meatless mince" consume the substitute word; any
 *     other "-free" marker (and "gluten-free") consumes only itself, so
 *     "gluten-free chicken" stays chicken.
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
const NOT_VEGAN_SEED_TITLES = ['Roti (Chapati)', 'Rasam', 'Jeera Rice', 'Plain Steamed Rice'];

const quoteList = (values: readonly string[]): string => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

const MEAT_PATTERN = String.raw`\m(chicken|mutton|lamb|goat|beef|pork|bacon|ham|turkey|duck|lard|gelatin|gelatine|mince|keema|sausage|meat|fish|prawn|shrimp|crab|lobster|oyster|clam|mussel|squid|salmon|tuna|sardine|mackerel|anchov(y|ies)|rohu|pomfret|hilsa|gosht|murgh|kheema|machli|machhi|meen|maachh|maach|jhinga)(s|es)?\M`;
const EGG_PATTERN = String.raw`\m(egg|mayonnaise|mayo|anda|omelette|omelet)(s|es)?\M`;
const HARMLESS_PATTERN = String.raw`\m(egg|dairy|meat)-free( [a-z]+)?\M|\m(meat|egg|dairy)less( [a-z]+)?\M|\mvegan (mayo|mayonnaise|eggs?|butter|cheese|milk|ghee)\M|\megg (replacer|substitute|replacement)\M|\mgoat(''s)? (cheese|milk)\M|\m(?!gluten-)[a-z]+-free\M`;
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

  UPDATE recipes
  SET dietary_tags = dietary_tags - 'vegan'
  WHERE source_type = 'curated'
    AND title IN (${quoteList(NOT_VEGAN_SEED_TITLES)})
    AND dietary_tags ? 'vegan';

  UPDATE recipes
  SET dietary_tags = dietary_tags - 'veg' - 'vegan' - 'jain'
  WHERE dietary_tags ? 'non_veg'
    AND dietary_tags ?| ARRAY['veg','vegan','jain'];

  WITH parts AS (
    SELECT r.id, lower(r.title) AS txt
    FROM recipes r
    WHERE NOT (r.dietary_tags ?| ${STYLE_TAGS})
    UNION ALL
    SELECT r.id, lower(ri.name) AS txt
    FROM recipes r
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE NOT (r.dietary_tags ?| ${STYLE_TAGS})
  ),
  cleaned AS (
    SELECT id, regexp_replace(txt, '${HARMLESS_PATTERN}', ' ', 'g') AS txt
    FROM parts
  ),
  verdict AS (
    SELECT id,
           bool_or(txt ~ '${MEAT_PATTERN}') AS has_meat,
           bool_or(txt ~ '${EGG_PATTERN}') AS has_egg
    FROM cleaned
    GROUP BY id
  )
  UPDATE recipes r
  SET dietary_tags = r.dietary_tags || to_jsonb(
    CASE
      WHEN v.has_meat THEN 'non_veg'
      WHEN v.has_egg THEN 'eggetarian'
      ELSE 'veg'
    END
  )
  FROM verdict v
  WHERE v.id = r.id;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(RETAG_DIET_STYLES_SQL);
}

export async function down(): Promise<void> {
  // Forward-only data fix: see the file header.
}
