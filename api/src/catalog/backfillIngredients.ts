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
 * Dry-run (`execute: false`) reads only. Execute mode commits per batch and
 * never waits on application writes (see `runIngredientBackfill`).
 */

export interface BackfillQueryClient {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface BackfillOptions {
  readonly execute: boolean;
  /** Rows locked, read and written per transaction (execute) or page (dry run). */
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

const DEFAULT_BATCH_SIZE = 200;
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

/** One table's batch loop: how to read a keyset page, plan a row and write the changed ones. */
interface TableSpec<Row extends { id: string; name: string; catalogMatch: CatalogMatch | null }> {
  readonly selectSql: string;
  readonly toRow: (row: Record<string, unknown>) => Row;
  readonly plan: (row: Row, canonicaliser: IngredientCanonicaliser) => Row | null;
  readonly write: (client: BackfillQueryClient, updates: readonly Row[]) => Promise<unknown>;
}

const RECIPE_SPEC: TableSpec<RecipeIngredientBackfillRow> = {
  selectSql: `SELECT id, name, quantity, unit, notes, ingredient_id, catalog_match
                FROM recipe_ingredients WHERE id > $1 ORDER BY id LIMIT $2`,
  toRow: toRecipeRow,
  plan: planRecipeIngredientBackfill,
  write: writeRecipeIngredients,
};

const PANTRY_SPEC: TableSpec<PantryBackfillRow> = {
  selectSql: `SELECT id, name, ingredient_id, catalog_match
                FROM pantry_items WHERE id > $1 ORDER BY id LIMIT $2`,
  toRow: toPantryRow,
  plan: planPantryBackfill,
  write: writePantryItems,
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Execute-mode reads lock the batch (`FOR UPDATE SKIP LOCKED`) inside the
 * batch's own transaction, so the state that is planned from is the state that
 * is overwritten: a concurrent rename either committed before the read (and is
 * classified) or holds the row lock (and the row is skipped, to be picked up
 * by the next run). Nothing waits on application writes, so no deadlocks.
 */
const lockedSql = (sql: string): string => `${sql} FOR UPDATE SKIP LOCKED`;

/** Rolls back without letting a failing rollback hide the error that caused it. */
const safeRollback = async (client: BackfillQueryClient): Promise<void> => {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection is already unusable; the original error is what matters.
  }
};

interface BatchOutcome {
  readonly keys: string[];
  readonly scanned: number;
  readonly updates: number;
}

const processBatch = async <Row extends { id: string; name: string; catalogMatch: CatalogMatch | null }>(
  client: BackfillQueryClient,
  spec: TableSpec<Row>,
  canonicaliser: IngredientCanonicaliser,
  scan: { tally: Tally; unmatched: Map<string, number> },
  page: { lastId: string; size: number },
  execute: boolean,
): Promise<BatchOutcome> => {
  const { rows } = await client.query(execute ? lockedSql(spec.selectSql) : spec.selectSql, [page.lastId, page.size]);
  const current = rows.map(spec.toRow);
  const updates: Row[] = [];
  for (const row of current) {
    const update = spec.plan(row, canonicaliser);
    const status = update?.catalogMatch ?? row.catalogMatch;
    scan.tally.scanned += 1;
    countStatus(scan.tally, status);
    recordUnmatched(scan.unmatched, update?.name ?? row.name, status);
    if (update !== null) {
      updates.push(update);
    }
  }
  scan.tally.changed += updates.length;
  if (execute && updates.length > 0) {
    await spec.write(client, updates);
  }
  return { keys: current.map((row) => row.id), scanned: current.length, updates: updates.length };
};

/**
 * Scans one table in keyset batches. Execute mode commits every batch in its
 * own short transaction (the work is idempotent, so a failure keeps earlier
 * batches and a re-run finishes the rest).
 */
const backfillTable = async <Row extends { id: string; name: string; catalogMatch: CatalogMatch | null }>(
  client: BackfillQueryClient,
  spec: TableSpec<Row>,
  canonicaliser: IngredientCanonicaliser,
  options: Required<BackfillOptions>,
  unmatched: Map<string, number>,
): Promise<TableBackfillReport> => {
  const scan = { tally: emptyTally(), unmatched };
  let lastId = NIL_UUID;
  for (;;) {
    if (options.execute) {
      await client.query('BEGIN');
    }
    let outcome: BatchOutcome;
    try {
      outcome = await processBatch(client, spec, canonicaliser, scan, { lastId, size: options.batchSize }, options.execute);
      if (options.execute) {
        await client.query('COMMIT');
      }
    } catch (error: unknown) {
      if (options.execute) {
        await safeRollback(client);
      }
      throw error;
    }
    const last = outcome.keys[outcome.keys.length - 1];
    if (last === undefined) {
      return scan.tally;
    }
    lastId = last;
  }
};

const topUnmatched = (counts: ReadonlyMap<string, number>): UnmatchedName[] =>
  [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_UNMATCHED);

/**
 * Runs the backfill. A dry run only reads. Execute mode holds a session
 * advisory lock (one backfill at a time) and commits per batch, locking rows
 * with SKIP LOCKED: rows a concurrent request holds are left for the next run,
 * so keep re-running until `changed` is 0.
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
  if (resolved.execute) {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [BACKFILL_LOCK_KEY]);
    if (rows[0]?.['locked'] !== true) {
      throw new Error('Another ingredient backfill is already running.');
    }
  }
  try {
    const unmatched = new Map<string, number>();
    const recipeIngredients = await backfillTable(client, RECIPE_SPEC, canonicaliser, resolved, unmatched);
    const pantryItems = await backfillTable(client, PANTRY_SPEC, canonicaliser, resolved, unmatched);
    return { executed: resolved.execute, recipeIngredients, pantryItems, topUnmatched: topUnmatched(unmatched) };
  } finally {
    if (resolved.execute) {
      await client.query('SELECT pg_advisory_unlock($1)', [BACKFILL_LOCK_KEY]).catch(() => undefined);
    }
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
