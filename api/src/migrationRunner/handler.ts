import { buildDatabaseUrl } from './buildDatabaseUrl.js';
import { loadProductionDeps } from './loadProductionDeps.js';
import type { MigrationRunnerDeps, MigrationRunnerEvent, MigrationRunnerResponse } from './types.js';

const APP_ROLE_PASSWORD_ENV_VAR = 'PARIMAAN_APP_ROLE_PASSWORD';

/**
 * A physical resource ID stable across `Create`/`Update`/`Delete` for the
 * same deployed database — this custom resource has no AWS-assigned ARN of
 * its own to use instead.
 */
const physicalResourceId = (deps: MigrationRunnerDeps): string =>
  `db-migrations:${deps.dbHost}:${deps.dbName}`;

/**
 * CloudFormation custom-resource Lambda handler for running database
 * migrations as part of `cdk deploy`, invoked by a `cr.Provider`. Built with
 * injectable dependencies (`MigrationRunnerDeps`) so tests can exercise the
 * real `runMigrations` against a real Testcontainers Postgres without ever
 * touching AWS Secrets Manager.
 *
 * On `Delete`, this returns immediately without running migrations in
 * either direction: a stack delete must never touch the database — running
 * `down` would drop tables and destroy data, and there is no scenario where
 * running a migration belongs in a Delete lifecycle event at all.
 */
export const createMigrationRunnerHandler =
  (deps: MigrationRunnerDeps) =>
  async (event: MigrationRunnerEvent): Promise<MigrationRunnerResponse> => {
    if (event.RequestType === 'Delete') {
      return { PhysicalResourceId: physicalResourceId(deps) };
    }

    const [adminCredentials, appRolePassword] = await Promise.all([
      deps.fetchDbAdminCredentials(),
      deps.fetchAppRolePassword(),
    ]);

    // The app-role migration (`migrations/1787124517648_app-role.ts`) reads
    // its LOGIN PASSWORD from this env var rather than accepting it as a
    // parameter, so it must be set before `runMigrations` runs.
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = appRolePassword;

    const databaseUrl = buildDatabaseUrl({
      username: adminCredentials.username,
      password: adminCredentials.password,
      host: deps.dbHost,
      port: deps.dbPort,
      dbName: deps.dbName,
    });

    // Both the admin connection password (embedded in `databaseUrl`) and the
    // app-role password (embedded in the app-role migration's `CREATE ROLE`
    // SQL) are real secrets that could otherwise reach CloudWatch via
    // node-pg-migrate's unconditional query-error logging — see the
    // `secretsToRedact` doc comment on `runMigrations` itself.
    await deps.runMigrations(databaseUrl, 'up', deps.migrationsDirOverride, [
      adminCredentials.password,
      appRolePassword,
    ]);

    return { PhysicalResourceId: physicalResourceId(deps) };
  };

/**
 * `loadProductionDeps()` is deliberately not called at module load — that
 * would make importing this module for its `createMigrationRunnerHandler`
 * export alone (as every test in this directory does) throw whenever the
 * `DB_SECRET_ARN`/etc. env vars aren't set, which is true in every test
 * environment. Instead, deps are constructed lazily on first invocation and
 * cached for the lifetime of the Lambda execution environment (the same
 * "compute once per cold start" behavior a top-level call would have given,
 * without coupling it to module import).
 */
let productionDeps: MigrationRunnerDeps | undefined;

export const handler = async (event: MigrationRunnerEvent): Promise<MigrationRunnerResponse> => {
  productionDeps ??= loadProductionDeps();
  return createMigrationRunnerHandler(productionDeps)(event);
};
