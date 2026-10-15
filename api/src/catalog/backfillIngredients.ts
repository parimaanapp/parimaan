import type { CatalogMatch, IngredientCanonicaliser } from '../domain/canonicaliseIngredient.js';
import { planPantryBackfill, planRecipeIngredientBackfill } from '../domain/ingredientBackfill.js';
import type {
  PantryBackfillRow,
  PantryUpdate,
  RecipeIngredientBackfillRow,
  RecipeIngredientUpdate,
} from '../domain/ingredientBackfill.js';

/**
 * One-off, idempotent backfill (B2b): canonicalises every household's
 * `recipe_ingredients` and `pantry_items` through the catalog, setting
 * `ingredient_id` and `catalog_match` and rewriting names/units exactly as the
 * write path now does. Rows that do not resolve (or are ambiguous) are kept
 * as-is and only flagged. Safe to re-run: a second run plans nothing.
 *
 * It reads and writes across all households, so it must run as a role that
 * bypasses RLS (superuser / BYPASSRLS), like the data migrations do.
 * Dry-run (`execute: false`) reads only.
 */

export interface BackfillQueryClient {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface BackfillOptions {
  readonly execute: boolean;
  /** Rows read and written per statement. */
  readonly batchSize?: number;
}

export interface TableBackfillReport {
  readonly scanned: number;
  readonly changed: number;
  readonly resolved: number;
  readonly ambiguous: number;
  readonly unresolved: number;
}

export interface UnmatchedName {
  readonly name: string;
  readonly count: number;
}

export interface BackfillReport {
  readonly executed: boolean;
  readonly recipeIngredients: TableBackfillReport;
  readonly pantryItems: TableBackfillReport;
  /** Most frequent names that did not resolve, across both tables: the curation backlog. No household data. */
  readonly topUnmatched: readonly UnmatchedName[];
}

const DEFAULT_BATCH_SIZE = 1000;
const TOP_UNMATCHED = 25;
/** Arbitrary constant namespacing this backfill's advisory lock. */
const BACKFILL_LOCK_KEY = 7_204_002;

interface Tally {
  scanned: number;
  changed: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
}

const emptyTally = (): Tally => ({ scanned: 0, changed: 0, resolved: 0, ambiguous: 0, unresolved: 0 });

const countStatus = (tally: Tally, status: CatalogMatch | null): void => {
  if (status === 'resolved') {
    tally.resolved += 1;
  } else if (status === 'ambiguous') {
    tally.ambiguous += 1;
  } else if (status === 'unresolved') {
    tally.unresolved += 1;
  }
};

const asNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const asStringOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

export const assertCanBypassRowSecurity = async (client: BackfillQueryClient): Promise<void> => {
  const { rows } = await client.query(
    `SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`,
  );
  if (rows[0]?.['bypass'] !== true) {
    throw new Error(
      'The backfill must run as a role that bypasses row-level security (superuser or BYPASSRLS); ' +
        'otherwise it would silently see no household rows.',
    );
  }
};

const recordUnmatched = (counts: Map<string, number>, name: string, status: CatalogMatch | null): void => {
  if (status === 'ambiguous' || status === 'unresolved') {
    const key = name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
};

const writeRecipeIngredients = (client: BackfillQueryClient, updates: readonly RecipeIngredientUpdate[]): Promise<unknown> =>
  client.query(
    `UPDATE recipe_ingredients ri
        SET name = v.name, quantity = v.quantity, unit = v.unit, notes = v.notes,
            ingredient_id = v.ingredient_id, catalog_match = v.catalog_match
       FROM jsonb_to_recordset($1::jsonb) AS v(
         id uuid, name text, quantity numeric, unit text, notes text, ingredient_id text, catalog_match text)
      WHERE ri.id = v.id`,
    [
      JSON.stringify(
        updates.map((u) => ({
          id: u.id,
          name: u.name,
          quantity: u.quantity,
          unit: u.unit,
          notes: u.notes,
          ingredient_id: u.ingredientId,
          catalog_match: u.catalogMatch,
        })),
      ),
    ],
  );

const writePantryItems = (client: BackfillQueryClient, updates: readonly PantryUpdate[]): Promise<unknown> =>
  client.query(
    `UPDATE pantry_items p
        SET name = v.name, ingredient_id = v.ingredient_id, catalog_match = v.catalog_match
       FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, name text, ingredient_id text, catalog_match text)
      WHERE p.id = v.id`,
    [
      JSON.stringify(
        updates.map((u) => ({
          id: u.id,
          name: u.name,
          ingredient_id: u.ingredientId,
          catalog_match: u.catalogMatch,
        })),
      ),
    ],
  );

const toRecipeRow = (row: Record<string, unknown>): RecipeIngredientBackfillRow => ({
  id: String(row['id']),
  name: String(row['name']),
  quantity: asNumberOrNull(row['quantity']),
  unit: asStringOrNull(row['unit']),
  notes: asStringOrNull(row['notes']),
  ingredientId: asStringOrNull(row['ingredient_id']),
  catalogMatch: asStringOrNull(row['catalog_match']) as CatalogMatch | null,
});

const toPantryRow = (row: Record<string, unknown>): PantryBackfillRow => ({
  id: String(row['id']),
  name: String(row['name']),
  ingredientId: asStringOrNull(row['ingredient_id']),
  catalogMatch: asStringOrNull(row['catalog_match']) as CatalogMatch | null,
});

interface Scan {
  readonly client: BackfillQueryClient;
  readonly options: Required<BackfillOptions>;
  readonly unmatched: Map<string, number>;
  readonly tally: Tally;
}

/** Counts one scanned row (using its post-plan state) and returns its update, if any. */
const tallyRow = <Row extends { id: string; name: string; catalogMatch: CatalogMatch | null }>(
  scan: Scan,
  current: Row,
  update: Row | null,
): Row | null => {
  const status = update?.catalogMatch ?? current.catalogMatch;
  scan.tally.scanned += 1;
  countStatus(scan.tally, status);
  recordUnmatched(scan.unmatched, update?.name ?? current.name, status);
  return update;
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const backfillRecipeIngredients = async (
  client: BackfillQueryClient,
  canonicaliser: IngredientCanonicaliser,
  options: Required<BackfillOptions>,
  unmatched: Map<string, number>,
): Promise<TableBackfillReport> => {
  const scan: Scan = { client, options, unmatched, tally: emptyTally() };
  let lastId = NIL_UUID;
  for (;;) {
    const { rows } = await client.query(
      `SELECT id, name, quantity, unit, notes, ingredient_id, catalog_match
         FROM recipe_ingredients WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, options.batchSize],
    );
    if (rows.length === 0) {
      return scan.tally;
    }
    const current = rows.map(toRecipeRow);
    const updates = current
      .map((row) => tallyRow(scan, row, planRecipeIngredientBackfill(row, canonicaliser)))
      .filter((update): update is RecipeIngredientUpdate => update !== null);
    scan.tally.changed += updates.length;
    if (options.execute && updates.length > 0) {
      await writeRecipeIngredients(client, updates);
    }
    lastId = current[current.length - 1]?.id ?? lastId;
  }
};

const backfillPantryItems = async (
  client: BackfillQueryClient,
  canonicaliser: IngredientCanonicaliser,
  options: Required<BackfillOptions>,
  unmatched: Map<string, number>,
): Promise<TableBackfillReport> => {
  const scan: Scan = { client, options, unmatched, tally: emptyTally() };
  let lastId = NIL_UUID;
  for (;;) {
    const { rows } = await client.query(
      `SELECT id, name, ingredient_id, catalog_match FROM pantry_items WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, options.batchSize],
    );
    if (rows.length === 0) {
      return scan.tally;
    }
    const current = rows.map(toPantryRow);
    const updates = current
      .map((row) => tallyRow(scan, row, planPantryBackfill(row, canonicaliser)))
      .filter((update): update is PantryUpdate => update !== null);
    scan.tally.changed += updates.length;
    if (options.execute && updates.length > 0) {
      await writePantryItems(client, updates);
    }
    lastId = current[current.length - 1]?.id ?? lastId;
  }
};

const topUnmatched = (counts: ReadonlyMap<string, number>): UnmatchedName[] =>
  [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_UNMATCHED);

/**
 * Runs the backfill. In execute mode everything happens in one transaction
 * under an advisory lock (a failure rolls back every table); a dry run reads
 * the same rows and reports what would change.
 */
export const runIngredientBackfill = async (
  client: BackfillQueryClient,
  canonicaliser: IngredientCanonicaliser,
  options: BackfillOptions,
): Promise<BackfillReport> => {
  const resolved: Required<BackfillOptions> = {
    execute: options.execute,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
  };
  await assertCanBypassRowSecurity(client);
  const unmatched = new Map<string, number>();
  if (resolved.execute) {
    await client.query('BEGIN');
  }
  try {
    if (resolved.execute) {
      await client.query('SELECT pg_advisory_xact_lock($1)', [BACKFILL_LOCK_KEY]);
    }
    const recipeIngredients = await backfillRecipeIngredients(client, canonicaliser, resolved, unmatched);
    const pantryItems = await backfillPantryItems(client, canonicaliser, resolved, unmatched);
    if (resolved.execute) {
      await client.query('COMMIT');
    }
    return { executed: resolved.execute, recipeIngredients, pantryItems, topUnmatched: topUnmatched(unmatched) };
  } catch (error: unknown) {
    if (resolved.execute) {
      await client.query('ROLLBACK');
    }
    throw error;
  }
};

export const formatBackfillReport = (report: BackfillReport): string => {
  const line = (label: string, t: TableBackfillReport): string =>
    `${label}: scanned ${t.scanned}, ${report.executed ? 'updated' : 'would update'} ${t.changed}, ` +
    `resolved ${t.resolved}, ambiguous ${t.ambiguous}, unresolved ${t.unresolved}`;
  const lines = [
    report.executed ? 'Ingredient backfill: EXECUTED' : 'Ingredient backfill: DRY RUN (no changes written)',
    line('recipe_ingredients', report.recipeIngredients),
    line('pantry_items', report.pantryItems),
  ];
  if (report.topUnmatched.length > 0) {
    lines.push('Most frequent names left unmatched:');
    for (const item of report.topUnmatched) {
      lines.push(`  ${item.count} x ${item.name}`);
    }
  }
  return lines.join('\n');
};
