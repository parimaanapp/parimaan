import type { CdkCustomResourceEvent, CdkCustomResourceResponse } from 'aws-lambda';
import type { runMigrations } from '../db/runMigrations.js';

/**
 * The event/response shapes here come from `@types/aws-lambda`'s
 * `CdkCustomResourceEvent`/`CdkCustomResourceResponse` — the pair documented
 * (see `trigger/cdk-custom-resource.d.ts`) as specifically for the CDK
 * `custom-resources` Provider framework's `onEvent` handler, as opposed to
 * `CloudFormationCustomResourceEvent`/`CloudFormationCustomResourceHandler`
 * (from `trigger/cloudformation-custom-resource.d.ts`), which model the
 * older raw pre-signed-URL protocol where the Lambda itself PUTs its
 * response to `ResponseURL` and returns `void`. This Lambda is invoked by a
 * `cr.Provider` (per the task context), so the Provider framework calls it
 * and expects a returned response object — never `void` — which it then
 * relays to CloudFormation itself.
 */
export type MigrationRunnerEvent = CdkCustomResourceEvent;
export type MigrationRunnerResponse = CdkCustomResourceResponse;

export interface DbAdminCredentials {
  username: string;
  password: string;
}

/**
 * Injectable dependencies for the migration-runner Lambda handler. Tests
 * supply fakes for the two Secrets-Manager-backed fetchers and the real
 * `runMigrations` (never mocked) against a Testcontainers Postgres;
 * `loadProductionDeps()` supplies the real AWS-backed versions at runtime.
 */
export interface MigrationRunnerDeps {
  fetchDbAdminCredentials: () => Promise<DbAdminCredentials>;
  fetchAppRolePassword: () => Promise<string>;
  runMigrations: typeof runMigrations;
  dbHost: string;
  dbPort: number;
  dbName: string;
  migrationsDirOverride?: string;
}
