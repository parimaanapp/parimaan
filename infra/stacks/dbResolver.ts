import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import type { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds';
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface DbResolverDeps {
  readonly vpc: IVpc;
  readonly dbCluster: DatabaseCluster;
  readonly appRoleSecret: Secret;
  readonly lambdaSecurityGroup: ISecurityGroup;
}

/**
 * W17 S1 (`E2E_MVP_PLAN.md` §23.2.1 D1, §23.3 S1) — picks which of
 * `network-stack.ts`'s two private subnet groups a DB-resolver Lambda lands
 * in. `false` (the default for every resolver through W16) keeps the
 * existing `PRIVATE_ISOLATED` placement — zero internet route, unchanged.
 * `true` places it in the new `private-egress` (`PRIVATE_WITH_EGRESS`)
 * group instead, for the rare Lambda that needs both real Aurora access AND
 * real internet egress in the same execution (W17's `staplesNoteFn`, added
 * in a later slice — S1 only builds the opt-in mechanism, no resolver sets
 * this flag yet). Extracted as its own pure function so the subnet-
 * selection logic is directly unit-testable without synthesizing a full
 * `NodejsFunction`/stack.
 */
export function resolveDbResolverVpcSubnets(needsInternetEgress: boolean): { subnetType: SubnetType } {
  return needsInternetEgress
    ? { subnetType: SubnetType.PRIVATE_WITH_EGRESS }
    : { subnetType: SubnetType.PRIVATE_ISOLATED };
}

/**
 * One VPC-attached, database-backed resolver Lambda: shared config for
 * every entry in `DB_RESOLVERS` — VPC subnet placement, the shared
 * `lambdaSecurityGroup`, and env vars for connecting to Aurora as
 * `parimaan_app` (never the cluster's admin secret — these Lambdas only
 * ever get read access to `appRoleSecret`).
 *
 * Extracted out of `ApiStack` as a standalone function (not a private
 * method), the same `createNonVpcResolverFunction` precedent
 * (`nonVpcResolver.ts`) already established — so it is directly
 * unit-testable against a throwaway stack, including the new
 * `needsInternetEgress` opt-in (W17 S1) with no production `DB_RESOLVERS`
 * entry needing to exist first.
 */
export function createDbResolverFunction(
  scope: Construct,
  id: string,
  entryFile: string,
  deps: DbResolverDeps,
  needsCuratedRecipes = false,
  needsInternetEgress = false,
): NodejsFunction {
  const { vpc, dbCluster, appRoleSecret, lambdaSecurityGroup } = deps;

  // W16 S5 — the curated-recipe corpus (`recipes/north-indian/` +
  // `recipes/south-indian/`, repo root) is bundled with the Lambda at
  // build time, not fetched at runtime (locked design — the same
  // "no new I/O dependency" reasoning `curated_pantry_items.dart` already
  // established client-side, applied here server-side). Before this
  // packaging fix, `api/src/curatedRecipes.ts` had a real reader but
  // NOTHING actually shipped `recipes/` alongside the bundled Lambda code:
  // `NodejsFunction`'s esbuild bundling only follows the JS/TS module
  // graph, and a `readdirSync`/`readFileSync` call against a relative
  // filesystem path is invisible to it — plain data, not an import. Left
  // unfixed, `getCuratedRecipesFromCorpus` would throw
  // "could not locate the curated recipes directory" on every real
  // `createHousehold` invocation in a deployed Lambda, despite every
  // local/Testcontainers test passing (those run from the actual repo
  // checkout, where `recipes/` genuinely sits two directories up from
  // `api/src/curatedRecipes.ts` — see that file's own
  // `resolveCuratedRecipesDir` doc). `commandHooks.afterBundling` copies
  // the directory into the same asset output directory esbuild's bundle
  // file lands in, matching `resolveCuratedRecipesDir`'s first (bundled)
  // candidate path — a plain `cp -r`, not a new packaging mechanism, only
  // applied to the one Lambda that actually reads this data
  // (`needsCuratedRecipes`), not every `DB_RESOLVERS` entry.
  const curatedRecipesBundling = needsCuratedRecipes
    ? {
        commandHooks: {
          beforeBundling: (): string[] => [],
          afterBundling: (inputDir: string, outputDir: string): string[] => [
            `cp -r "${join(inputDir, 'recipes')}" "${join(outputDir, 'recipes')}"`,
          ],
          beforeInstall: (): string[] => [],
        },
      }
    : {};

  const fn = new NodejsFunction(scope, id, {
    entry: join(__dirname, `../../api/src/resolvers/${entryFile}`),
    runtime: Runtime.NODEJS_24_X,
    handler: 'handler',
    vpc,
    // W17 S1 — `needsInternetEgress` (default false) is the only thing
    // that changes about this Lambda's placement; see
    // `resolveDbResolverVpcSubnets`'s own doc for the full reasoning.
    vpcSubnets: resolveDbResolverVpcSubnets(needsInternetEgress),
    securityGroups: [lambdaSecurityGroup],
    // Aurora Serverless v2's auto-pause resume can take up to ~30s (the
    // mobile app's own copy — `NameHouseholdScreen.coldStartHint` — tells
    // the user exactly that), and connecting is only the first part of an
    // invocation that then still has to run the actual query/transaction.
    // A 30s function timeout left no headroom at all for that: a genuine
    // first-request-after-pause reliably timed out at the *connection*
    // step alone (`pool.ts`'s `connectionTimeoutMillis`, previously 5s —
    // shorter still), well before the function timeout ever mattered.
    // Caught only by a real cold Aurora invocation — nothing synth-time or
    // unit-tested exercises actual connection latency. 45s leaves roughly
    // 10-15s for the query itself after the worst-case 30s resume.
    timeout: cdk.Duration.seconds(45),
    memorySize: 512,
    tracing: Tracing.ACTIVE,
    // No `reservedConcurrentExecutions` here (yet). There is no RDS Proxy
    // in front of Aurora (locked decision, `SYSTEM_DESIGN.md` §7.1/
    // `E2E_MVP_PLAN.md` §10 Q1), so every concurrent Lambda invocation is
    // its own Postgres connection, and a per-function reservation is the
    // intended long-term guard against a burst opening more connections
    // than Aurora can hold. It is left unset right now because this AWS
    // account currently has a fresh-account Lambda concurrency quota of
    // only 10 *total*, and AWS rejects any reservation that would leave
    // fewer than 10 unreserved — so even one reserved execution on one
    // function fails deployment outright today. The account's own
    // 10-execution ceiling already bounds simultaneous Aurora connections
    // far more tightly than a reservation would have, so nothing is
    // actually unprotected in the meantime — this is a today's-account-
    // limits accommodation, not a safety rollback. Add
    // `reservedConcurrentExecutions: 5` (or similar, weighed against
    // `data-stack.ts`'s `AuroraConnectionsAlarm` threshold) back once a
    // quota increase is requested and granted.
    environment: {
      APP_ROLE_SECRET_ARN: appRoleSecret.secretArn,
      DB_HOST: dbCluster.clusterEndpoint.hostname,
      DB_PORT: dbCluster.clusterEndpoint.port.toString(),
      DB_NAME: 'parimaan',
    },
    // See `data-stack.ts`'s identical `esbuildArgs` comment — trims
    // esbuild's own CLI logging, a documented aggravating factor in a
    // CI-only Vitest worker-IPC-heartbeat flake. This is the largest
    // single contributor: every `DB_RESOLVERS` entry is built through
    // this one factory. `...curatedRecipesBundling` (W16 S5) adds the
    // `commandHooks` copy step above ONLY for the one entry that set
    // `needsCuratedRecipes` — an empty object for every other resolver,
    // so this spread is a no-op for them.
    bundling: { esbuildArgs: { '--log-level': 'error' }, ...curatedRecipesBundling },
  });

  appRoleSecret.grantRead(fn);
  return fn;
}
