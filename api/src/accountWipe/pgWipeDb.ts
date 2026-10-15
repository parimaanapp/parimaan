import { classifyHouseholds } from './households.js';
import { DELETE_STEPS, scopedWhere } from './steps.js';
import type {
  DbDeleteResult,
  DbListing,
  HouseholdMember,
  HouseholdWithMembers,
  NullifiedReference,
  TableRows,
  WipeDb,
  WipeUser,
} from './types.js';

/** The slice of `pg.Client` this adapter needs, so tests and callers can inject any compatible client. */
export interface SqlClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const asString = (value: unknown): string => String(value);

const assertCanBypassRls = async (client: SqlClient): Promise<void> => {
  const { rows } = await client.query(
    `SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`,
  );
  if (rows[0]?.['ok'] !== true) {
    throw new Error(
      'The database role cannot bypass row level security (tables use FORCE ROW LEVEL SECURITY). ' +
        'Connect as the cluster admin role, not parimaan_app, otherwise the listing would be silently empty.',
    );
  }
};

const loadUsers = async (
  client: SqlClient,
  emails: readonly string[],
  subs: readonly string[],
): Promise<WipeUser[]> => {
  const { rows } = await client.query(
    `SELECT id, cognito_sub, email FROM users
     WHERE lower(email) = ANY($1::text[]) OR cognito_sub = ANY($2::text[])
     ORDER BY id`,
    [emails, subs],
  );
  return rows.map((r) => ({
    id: asString(r['id']),
    cognitoSub: asString(r['cognito_sub']),
    email: asString(r['email']),
  }));
};

const loadTouchedHouseholds = async (
  client: SqlClient,
  userIds: readonly string[],
): Promise<HouseholdWithMembers[]> => {
  const households = await client.query(
    `SELECT id, name, primary_user_id FROM households
     WHERE primary_user_id = ANY($1::uuid[])
        OR id IN (SELECT household_id FROM household_memberships WHERE user_id = ANY($1::uuid[]))
     ORDER BY id`,
    [userIds],
  );
  const ids = households.rows.map((r) => asString(r['id']));
  const memberRows = await client.query(
    `SELECT id, household_id, user_id, role, joined_at::text AS joined_at
     FROM household_memberships WHERE household_id = ANY($1::uuid[])
     ORDER BY household_id, joined_at, id`,
    [ids],
  );
  return households.rows.map((h) => {
    const members: HouseholdMember[] = memberRows.rows
      .filter((m) => asString(m['household_id']) === asString(h['id']))
      .map((m) => ({
        membershipId: asString(m['id']),
        userId: asString(m['user_id']),
        role: m['role'] === 'primary' ? 'primary' : 'member',
        joinedAt: asString(m['joined_at']),
      }));
    return {
      id: asString(h['id']),
      name: asString(h['name']),
      primaryUserId: h['primary_user_id'] === null ? null : asString(h['primary_user_id']),
      members,
    };
  });
};

const loadTableRows = async (
  client: SqlClient,
  householdIds: readonly string[],
  userIds: readonly string[],
): Promise<TableRows[]> => {
  const result: TableRows[] = [];
  for (const step of DELETE_STEPS) {
    const { rows } = await client.query(
      `SELECT ${step.keyExpr} AS key FROM ${step.table} WHERE ${scopedWhere(step)} ORDER BY 1`,
      [householdIds, userIds],
    );
    result.push({ table: step.table, keys: rows.map((r) => asString(r['key'])) });
  }
  return result;
};

const NULLIFIED_REFERENCE_QUERIES: readonly {
  readonly table: string;
  readonly column: string;
  readonly sql: string;
}[] = [
  {
    table: 'pantry_items',
    column: 'added_by',
    sql: `SELECT count(*) AS n FROM pantry_items WHERE added_by = ANY($2::uuid[]) AND household_id <> ALL($1::uuid[])`,
  },
  {
    table: 'recipes',
    column: 'created_by',
    sql: `SELECT count(*) AS n FROM recipes WHERE created_by = ANY($2::uuid[]) AND household_id <> ALL($1::uuid[])`,
  },
  {
    table: 'shopping_list_items',
    column: 'purchased_by',
    sql: `SELECT count(*) AS n FROM shopping_list_items WHERE purchased_by = ANY($2::uuid[])
          AND shopping_list_id NOT IN (SELECT id FROM shopping_lists WHERE household_id = ANY($1::uuid[]))`,
  },
];

const loadNullifiedReferences = async (
  client: SqlClient,
  householdIds: readonly string[],
  userIds: readonly string[],
): Promise<NullifiedReference[]> => {
  const result: NullifiedReference[] = [];
  for (const q of NULLIFIED_REFERENCE_QUERIES) {
    const { rows } = await client.query(q.sql, [householdIds, userIds]);
    result.push({ table: q.table, column: q.column, count: Number(rows[0]?.['n'] ?? 0) });
  }
  return result;
};

/** Builds the complete DB-side listing. Read-only. */
export const loadDbListing = async (
  client: SqlClient,
  emails: readonly string[],
  subs: readonly string[],
): Promise<DbListing> => {
  const users = await loadUsers(client, emails, subs);
  const userIds = users.map((u) => u.id);
  const households = await loadTouchedHouseholds(client, userIds);
  const classification = classifyHouseholds(households, new Set(userIds));
  const householdIds = classification.deleted.map((h) => h.id);
  return {
    users,
    householdsDeleted: classification.deleted,
    householdsKept: classification.kept,
    promotions: classification.promotions,
    nullifiedReferences: await loadNullifiedReferences(client, householdIds, userIds),
    tables: await loadTableRows(client, householdIds, userIds),
  };
};

const sameListing = (a: DbListing, b: DbListing): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const applyPromotions = async (client: SqlClient, listing: DbListing): Promise<number> => {
  for (const p of listing.promotions) {
    await client.query(`UPDATE household_memberships SET role = 'primary' WHERE id = $1`, [
      p.membershipId,
    ]);
    await client.query(`UPDATE households SET primary_user_id = $1 WHERE id = $2`, [
      p.newPrimaryUserId,
      p.householdId,
    ]);
  }
  return listing.promotions.length;
};

const applyDeletes = async (
  client: SqlClient,
  listing: DbListing,
): Promise<DbDeleteResult['deletedByTable']> => {
  const householdIds = listing.householdsDeleted.map((h) => h.id);
  const userIds = listing.users.map((u) => u.id);
  const deleted: { table: string; count: number }[] = [];
  for (const step of DELETE_STEPS) {
    const planned = listing.tables.find((t) => t.table === step.table)?.keys.length ?? 0;
    const res = await client.query(`DELETE FROM ${step.table} WHERE ${scopedWhere(step)}`, [
      householdIds,
      userIds,
    ]);
    const count = res.rowCount ?? 0;
    if (count !== planned) {
      throw new Error(
        `Deleted ${count} row(s) from ${step.table} but the approved listing had ${planned}. Rolling back.`,
      );
    }
    deleted.push({ table: step.table, count });
  }
  return deleted;
};

/**
 * Postgres implementation of the wipe DB port. The caller owns the connection
 * (a single already-connected `pg.Client`); this adapter owns transactions:
 * snapshot runs `REPEATABLE READ, READ ONLY`, execute runs everything in ONE `REPEATABLE READ` transaction (listing and deletes see one snapshot) and
 * rolls back if the database no longer matches the approved listing or any
 * step deletes a different number of rows than listed.
 */
export const createPgWipeDb = (client: SqlClient): WipeDb => ({
  snapshot: async (emails, subs) => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await assertCanBypassRls(client);
      return await loadDbListing(client, emails, subs);
    } finally {
      await client.query('ROLLBACK');
    }
  },

  execute: async (emails, subs, expected) => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await assertCanBypassRls(client);
      const current = await loadDbListing(client, emails, subs);
      if (!sameListing(current, expected)) {
        throw new Error(
          'Database content no longer matches the approved listing; nothing was deleted.',
        );
      }
      const promotionsApplied = await applyPromotions(client, expected);
      const deletedByTable = await applyDeletes(client, expected);
      await client.query('COMMIT');
      return { deletedByTable, promotionsApplied };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  },
});
