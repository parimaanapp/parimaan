import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Written as raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts: CREATE ROLE, GRANT, and FORCE ROW LEVEL
// SECURITY don't have a clean high-level API in node-pg-migrate.

const APP_ROLE = 'parimaan_app';
const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';

const BASELINE_TABLES = ['users', 'households', 'household_settings', 'household_memberships'];

/**
 * Reads the app role's login password from the environment, throwing a
 * clear, actionable error rather than letting `CREATE ROLE ... PASSWORD
 * undefined` fail with a cryptic Postgres syntax error at migration-run
 * time. The password is never hardcoded in this file: in every real
 * environment (including CI/Testcontainers runs of this migration's own
 * test suite) it's provided as an env var, and in production it's rotated
 * via Secrets Manager independently of this migration.
 */
const readAppRolePassword = (): string => {
  const password = process.env[APP_ROLE_PASSWORD_ENV_VAR];
  if (password === undefined || password.length === 0) {
    throw new Error(
      `${APP_ROLE_PASSWORD_ENV_VAR} must be set before running this migration ` +
        `(it becomes the LOGIN PASSWORD for the '${APP_ROLE}' role).`,
    );
  }
  return password;
};

/**
 * Escapes a value for safe interpolation inside a single-quoted Postgres
 * string literal (standard SQL escaping: double up embedded single quotes).
 *
 * This is deliberately NOT done via `pgm.sql()`'s parameterized-args second
 * argument (`{ [key: string]: Name | Value }`). Verified empirically against
 * the installed node-pg-migrate v9.0.0
 * (dist/legacy/utils/createTransformer.js): when a plain JS string is
 * passed as an arg value, the substitution always calls `literal(val)` —
 * i.e. it treats the string as a `Name` (a quoted *identifier*, via double
 * quotes), never as an escaped `Value` (a quoted string *literal*). Value
 * escaping (`escapeValue`) only triggers for booleans/numbers/null/arrays/
 * PgLiteral, not for the plain-string branch. So there is no built-in path
 * in `pgm.sql()` for safely binding a JS string as a SQL string literal —
 * confirmed by node-pg-migrate not laundering it through `pg`'s wire-level
 * bind parameters either (this DDL isn't run through a parameterized query
 * at all; `pgm.sql()` returns a plain SQL string that's executed directly,
 * and Postgres DDL statements like CREATE ROLE don't support bind
 * parameters over the wire protocol regardless).
 *
 * Given that, manual escaping is the correct fallback here — and it's safe
 * specifically because the input is `PARIMAAN_APP_ROLE_PASSWORD`, a
 * deploy-time environment variable under operator control, never
 * user-supplied input. Standard `''`-doubling escaping is sufficient
 * because Postgres has had `standard_conforming_strings = on` by default
 * since 9.1 (backslashes are not special inside `'...'` literals) — and
 * `up()` sets it explicitly with `SET LOCAL` rather than trusting the
 * target database's default, since a password ending in an odd number of
 * backslashes would only be safe under that setting; a non-default
 * `standard_conforming_strings = off` parameter group is unlikely but not
 * impossible, and this makes the escaping's safety hold unconditionally.
 */
const escapeStringLiteral = (value: string): string => value.replace(/'/g, "''");

const grantCrudOnBaselineTables = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    -- Explicit, even though Postgres 16 still grants USAGE on the public
    -- schema to PUBLIC by default: relying on that default means a future
    -- hardening migration (REVOKE ALL ON SCHEMA public FROM PUBLIC, a
    -- documented best practice) would silently strip parimaan_app's ability
    -- to reach any table here, surfacing as a runtime "permission denied
    -- for schema public" in a Lambda resolver rather than at migration time.
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ${BASELINE_TABLES.join(', ')} TO ${APP_ROLE};
  `);
};

const forceRlsOnHouseholdSettings = (pgm: MigrationBuilder): void => {
  // household_settings already has ROW LEVEL SECURITY enabled (see the
  // baseline migration) and parimaan_app is neither its owner nor a
  // superuser, so the policy already applies to it as-is. FORCE is added
  // anyway as defense-in-depth: it's a no-op for parimaan_app today, but it
  // guarantees the policy still holds even if the table's owner role is
  // ever accidentally used to connect (RLS is otherwise silently skipped
  // for the owner, regardless of which non-owner roles also exist).
  pgm.sql(`
    ALTER TABLE household_settings FORCE ROW LEVEL SECURITY;
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  const password = readAppRolePassword();

  pgm.sql(`
    SET LOCAL standard_conforming_strings = on;
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${escapeStringLiteral(password)}';
  `);

  grantCrudOnBaselineTables(pgm);
  forceRlsOnHouseholdSettings(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE household_settings NO FORCE ROW LEVEL SECURITY;
    REVOKE SELECT, INSERT, UPDATE, DELETE ON ${BASELINE_TABLES.join(', ')} FROM ${APP_ROLE};
    REVOKE USAGE ON SCHEMA public FROM ${APP_ROLE};
    DROP ROLE IF EXISTS ${APP_ROLE};
  `);
}
