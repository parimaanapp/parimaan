import type { Client, PoolClient } from 'pg';
import { normaliseKey } from '../domain/ingredientCatalog.js';
import type { CatalogBundle } from './buildBundle.js';
import { catalogBundle, catalogContentHash } from './bundle.js';

export type CatalogSyncClient = Pick<Client | PoolClient, 'query'>;

export interface CatalogSyncResult {
  readonly status: 'synced' | 'unchanged';
  readonly hash: string;
  readonly ingredients: number;
  readonly aliases: number;
  readonly conversions: number;
}

/** Arbitrary constant namespacing this sync's advisory lock. */
const SYNC_LOCK_KEY = 7_204_001;

interface AliasRow {
  readonly key: string;
  readonly ingredientId: string;
  readonly display: string;
}

const aliasRows = (bundle: CatalogBundle): AliasRow[] => {
  const rows: AliasRow[] = [];
  for (const ingredient of bundle.ingredients) {
    const ownKey = normaliseKey(ingredient.canonicalName, { keepParentheticals: true });
    const seen = new Set<string>([ownKey]);
    for (const display of ingredient.aliases) {
      const key = normaliseKey(display, { keepParentheticals: true });
      if (key === '' || seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({ key, ingredientId: ingredient.id, display });
    }
  }
  return rows;
};

const writeBundle = async (
  client: CatalogSyncClient,
  bundle: CatalogBundle,
  aliases: readonly AliasRow[],
): Promise<void> => {
  const { ingredients, conversions } = bundle;

  // Unit lists travel as JSON text, not text[][] (ragged arrays are not
  // representable as a Postgres multidimensional array).
  await client.query(
    `INSERT INTO ingredient_catalog
       (id, canonical_name, app_category, subcategory, allowed_units, default_unit, piece_g, cup_g, note)
     SELECT id, name, category, subcategory,
            ARRAY(SELECT jsonb_array_elements_text(units)),
            default_unit, piece_g, cup_g, note
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id text, name text, category text, subcategory text, units jsonb,
         default_unit text, piece_g numeric, cup_g numeric, note text)
     ON CONFLICT (id) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       app_category = EXCLUDED.app_category,
       subcategory = EXCLUDED.subcategory,
       allowed_units = EXCLUDED.allowed_units,
       default_unit = EXCLUDED.default_unit,
       piece_g = EXCLUDED.piece_g,
       cup_g = EXCLUDED.cup_g,
       note = EXCLUDED.note`,
    [
      JSON.stringify(
        ingredients.map((item) => ({
          id: item.id,
          name: item.canonicalName,
          category: item.appCategory,
          subcategory: item.subcategory,
          units: item.allowedUnits,
          default_unit: item.defaultUnit,
          piece_g: item.pieceG,
          cup_g: item.cupG,
          note: item.note,
        })),
      ),
    ],
  );

  // Removed ingredients go away, taking their aliases with them (ON DELETE CASCADE).
  await client.query('DELETE FROM ingredient_catalog WHERE id <> ALL($1::text[])', [
    ingredients.map((item) => item.id),
  ]);

  // Aliases and conversions are fully derived, so replace them wholesale.
  await client.query('DELETE FROM ingredient_aliases');
  await client.query(
    `INSERT INTO ingredient_aliases (alias_key, ingredient_id, alias_display)
     SELECT alias_key, ingredient_id, alias_display
       FROM jsonb_to_recordset($1::jsonb) AS t(alias_key text, ingredient_id text, alias_display text)`,
    [
      JSON.stringify(
        aliases.map((row) => ({
          alias_key: row.key,
          ingredient_id: row.ingredientId,
          alias_display: row.display,
        })),
      ),
    ],
  );

  await client.query('DELETE FROM unit_conversions');
  await client.query(
    `INSERT INTO unit_conversions (scope, key, unit, base_unit, amount)
     SELECT scope, key, unit, base_unit, amount
       FROM jsonb_to_recordset($1::jsonb) AS t(scope text, key text, unit text, base_unit text, amount numeric)`,
    [
      JSON.stringify(
        conversions.map((row) => ({
          scope: row.scope,
          key: row.key,
          unit: row.unit,
          base_unit: row.baseUnit,
          amount: row.amount,
        })),
      ),
    ],
  );
};

/**
 * Loads the bundled catalog into `ingredient_catalog`, `ingredient_aliases`
 * and `unit_conversions`, only when the bundle's content hash differs from the
 * one recorded in `catalog_sync_state`. Runs in one transaction under an
 * advisory lock, so a failure leaves the previous data and hash untouched and
 * concurrent deploys serialise. Must be given a connection that can write the
 * catalog tables (the migration runner's admin connection), not the app role.
 */
export const syncCatalog = async (
  client: CatalogSyncClient,
  bundle: CatalogBundle = catalogBundle,
): Promise<CatalogSyncResult> => {
  const hash = catalogContentHash(bundle);
  const aliases = aliasRows(bundle);
  const counts = {
    ingredients: bundle.ingredients.length,
    aliases: aliases.length,
    conversions: bundle.conversions.length,
  };

  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SYNC_LOCK_KEY]);
    const state = await client.query<{ content_hash: string }>(
      'SELECT content_hash FROM catalog_sync_state WHERE id = 1',
    );
    if (state.rows[0]?.content_hash === hash) {
      await client.query('COMMIT');
      return { status: 'unchanged', hash, ...counts };
    }

    await writeBundle(client, bundle, aliases);
    await client.query(
      `INSERT INTO catalog_sync_state (id, content_hash, synced_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET content_hash = EXCLUDED.content_hash, synced_at = EXCLUDED.synced_at`,
      [hash],
    );
    await client.query('COMMIT');
    return { status: 'synced', hash, ...counts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};
