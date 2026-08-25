import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Port, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import {
  AttributeType,
  BillingMode,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import type { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
} from 'aws-cdk-lib/aws-rds';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Provider } from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import { hashMigrationsDir } from '../lib/hashMigrationsDir';

/**
 * Resolves `pkgName`'s real, on-disk package directory from `fromDir`,
 * without going through `require.resolve('<pkgName>/package.json')` — several
 * packages in this closure (`lru-cache`, pulled in via `glob`) declare a
 * strict `exports` map that does not list `./package.json` as a permitted
 * subpath, which makes that form throw `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * even though the package resolves and loads completely normally otherwise.
 * Resolving the package's actual entry point instead (which every package
 * must expose, by definition, to be `require`-able at all) and then locating
 * the last `/node_modules/<pkgName>/` segment in that resolved path sidesteps
 * the restriction entirely — it never asks for a subpath the package didn't
 * choose to export.
 */
const resolvePackageDir = (pkgName: string, fromDir: string): string => {
  // Synth-time-only filesystem lookup (CDK synth runs as CommonJS per
  // infra/tsconfig.json) — not part of the deployed Lambda bundle.
  const entryPath = require.resolve(pkgName, { paths: [fromDir] });
  const marker = `/node_modules/${pkgName}/`;
  const markerIndex = entryPath.lastIndexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      `Could not locate a "${marker}" segment in "${pkgName}"'s resolved entry point ` +
        `("${entryPath}") — this package's on-disk layout doesn't match the pnpm ` +
        'structure this resolver assumes.',
    );
  }
  return entryPath.slice(0, markerIndex + marker.length - 1);
};

/**
 * Resolves `pkgName`'s real, already-installed directory, plus every runtime
 * (`dependencies`, never `devDependencies`) dependency it transitively pulls
 * in — recursively, to whatever depth the graph actually goes.
 *
 * This exists because pnpm's isolated `node_modules` layout nests nothing: a
 * package's own dependencies are never inside that package's directory, only
 * as **sibling** symlinks in the parent `.pnpm/<pkg>@<version>/node_modules/`
 * snapshot directory the package itself lives in. That is true of
 * `node-pg-migrate` (whose siblings are `glob`, `jiti`, `yargs`) and equally
 * true one level down of `pg` (whose siblings are `pg-connection-string`,
 * `pg-pool`, `pg-protocol`, `pg-types`, `pgpass`) — a first version of this
 * function copied only `node-pg-migrate`'s own siblings and missed `pg`'s,
 * which failed at Lambda cold start with `Cannot find module 'pg-types'`, one
 * dependency deeper than the version before *that* had failed on `glob`. Both
 * were the same bug at a different depth, caught only by a real deploy —
 * nothing here or in CI ever invokes this Lambda.
 *
 * The fix generalises instead of patching one more depth: walk the real
 * `package.json` "dependencies" field of every package encountered, resolved
 * from *that package's own directory* (not `api/`'s) so a transitive
 * dependency's own transitive dependencies resolve correctly too, and return
 * the flattened `{ name -> realDirectory }` map. `resolved` is the
 * caller-shared accumulator/seen-set — recursion stops at an already-visited
 * package name rather than re-walking a diamond dependency.
 *
 * **`peerDependencies` are not walked** — that field means "the consumer
 * supplies this", not "this package brings it along", so a generic walk has
 * no way to know whether a given peer is actually needed at runtime by the
 * one entry point being bundled. `pg` is exactly this shape for
 * `node-pg-migrate` (a `peerDependency`, needed because `node-pg-migrate`
 * really does `require('pg')` internally) — see the caller, which resolves
 * `pg` as its own explicit second root into the same closure rather than
 * teaching this function to guess which peers matter.
 */
const resolveDependencyClosure = (
  pkgName: string,
  fromDir: string,
  resolved: Map<string, string> = new Map(),
): Map<string, string> => {
  if (resolved.has(pkgName)) {
    return resolved;
  }
  const pkgDir = resolvePackageDir(pkgName, fromDir);
  resolved.set(pkgName, pkgDir);

  const packageJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const depName of Object.keys(packageJson.dependencies ?? {})) {
    resolveDependencyClosure(depName, pkgDir, resolved);
  }
  return resolved;
};

/**
 * `api/src/db/runMigrations.ts` computes its default migrations path via
 * `import.meta.url` — esbuild's default CJS output format makes
 * `import.meta` empty, which would throw at Lambda cold-start the moment
 * that module is imported (before `MIGRATIONS_DIR`'s env-var override even
 * gets a chance to matter). ESM keeps `import.meta` meaningful; Node 24's
 * Lambda runtime supports it natively.
 *
 * `node-pg-migrate` is left un-inlined (`externalModules`) because it loads
 * migration files from disk at runtime via `jiti`, which a single-file
 * esbuild bundle would not preserve. Rather than relying on CDK's
 * `bundling.nodeModules` (which shells out to a fresh `pnpm install`
 * *inside the ephemeral bundling temp directory* — this proved flaky in CI:
 * a bare `CommandExitedWithNonZeroStatus ... exited with status 1` with no
 * further detail, passing consistently in local dev but failing every run
 * on GitHub Actions), every package in `node-pg-migrate`'s full transitive
 * runtime dependency closure (see [resolveDependencyClosure]) is copied
 * directly from this repo's own `node_modules`, via `cp -RL` per package —
 * `-L` dereferences pnpm's symlinked `.pnpm` store layout into real files,
 * and each package lands **flat**, directly under the bundle's own
 * `node_modules/<name>`, which is what makes Node's own upward-walking
 * module resolution find every one of them from any depth in the bundle.
 *
 * `pg` is resolved as its own second root, merged into the same closure —
 * see [resolveDependencyClosure]'s doc on why a `peerDependency` needs an
 * explicit root rather than a generic walk.
 *
 * `banner` patches in a real `require` for the ESM output esbuild produces.
 * `loadProductionDeps.ts` reads the DB secret via `@aws-sdk/client-secrets-
 * manager`, whose transitive `@smithy/node-http-handler` calls Node's own
 * `require('node:https')` at runtime rather than a static top-level import
 * (its own way of deferring the choice between `http` and `https`). esbuild
 * cannot see through that, so under `OutputFormat.ESM` it replaces the
 * `require` calls it cannot statically resolve with a shim that throws
 * `Dynamic require of "..." is not supported` — real behavior only a live
 * invocation exercises, not synth or any test. The fix is the standard one
 * for esbuild-bundled ESM Lambdas that need CJS-style `require` at runtime:
 * inject a real one via `createRequire(import.meta.url)`, which Node.js
 * itself provides for exactly this purpose.
 */
const createMigrationRunnerBundlingOptions = (migrationsSourceDir: string): BundlingOptions => {
  const apiPackageDir = join(__dirname, '../../api');
  const closure = resolveDependencyClosure('node-pg-migrate', apiPackageDir);
  resolveDependencyClosure('pg', apiPackageDir, closure);

  return {
    format: OutputFormat.ESM,
    externalModules: ['node-pg-migrate'],
    banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    commandHooks: {
      beforeBundling: (): string[] => [],
      beforeInstall: (): string[] => [],
      afterBundling: (_inputDir: string, outputDir: string): string[] => [
        `cp -r "${migrationsSourceDir}" "${outputDir}/migrations"`,
        `mkdir -p "${outputDir}/node_modules"`,
        ...Array.from(closure.entries()).map(
          ([name, dir]) => `cp -RL "${dir}" "${outputDir}/node_modules/${name}"`,
        ),
      ],
    },
  };
};

export interface DataStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
  /**
   * VPC from NetworkStack — DataStack does not create its own.
   * Typed as the concrete `Vpc` class (matching `NetworkStack.vpc`'s type),
   * not the `IVpc` interface — `Vpc` assigned to an `IVpc`-typed parameter
   * fails under `exactOptionalPropertyTypes` due to a structural mismatch
   * in aws-cdk-lib's own type declarations, unrelated to any real bug here.
   */
  readonly vpc: Vpc;
}

/**
 * Aurora Serverless v2 Postgres, S3 uploads/exports buckets, and the
 * DynamoDB cache/rate-limit table. See SYSTEM_DESIGN.md §7.1-§7.3.
 *
 * No RDS Proxy — locked decision E2E_MVP_PLAN.md §10 Q1: direct Postgres
 * connections first, RDS Proxy only if a later connection-load spike shows
 * failures.
 *
 * "Account-managed KMS key" in SYSTEM_DESIGN.md §13.1 is interpreted as the
 * AWS-managed default key (`aws/rds`), not a customer-managed key we'd
 * create and pay for — consistent with DynamoDB's parallel "AWS-owned key"
 * line one paragraph below it, and with the cost-discipline theme running
 * through PRD.md §17.4. No `kms.Key` resource is created in this stack.
 */
export class DataStack extends cdk.Stack {
  public readonly dbCluster: DatabaseCluster;
  public readonly uploadsBucket: Bucket;
  public readonly exportsBucket: Bucket;
  public readonly cacheTable: Table;
  /**
   * Shared by every VPC-attached Lambda that needs to reach Aurora —
   * api-stack's resolver Lambdas attach to this, rather than each stack
   * declaring/wiring its own ingress rule. See the constructor comment at
   * its declaration for why this lives here instead of in api-stack.
   */
  public readonly lambdaSecurityGroup: SecurityGroup;
  /** Login password for the `parimaan_app` Postgres role (see the app-role migration). */
  public readonly appRoleSecret: Secret;
  /**
   * Where Aurora's own CloudWatch alarms publish. Public so a later slice
   * (Lambda error-rate alarms, say) can reuse the same topic rather than
   * standing up a second one — nothing in this stack requires that reuse
   * today. No subscription is created here: that is a "notify a real person"
   * decision this stack should not make silently on someone's behalf.
   */
  public readonly alertsTopic: Topic;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { envName } = props;
    // aws-cdk-lib's own `SecurityGroup`/`DatabaseCluster` constructs declare
    // `vpc: IVpc`, and assigning the concrete `Vpc` class to that fails under
    // `exactOptionalPropertyTypes` — a structural mismatch on one optional
    // field (`vpnGatewayId`) in aws-cdk-lib's types, not a real unsoundness:
    // `Vpc` implements every member `IVpc` needs at runtime. Narrow, documented
    // cast at the one point it's needed, rather than disabling the strict flag
    // project-wide (which has already caught two real bugs elsewhere).
    const vpc = props.vpc as IVpc;

    const { dbSecurityGroup, lambdaSecurityGroup } = this.createSecurityGroups(vpc);
    this.lambdaSecurityGroup = lambdaSecurityGroup;

    const { dbCluster, dbSecret } = this.createAuroraCluster(vpc, dbSecurityGroup);
    this.dbCluster = dbCluster;

    this.alertsTopic = new Topic(this, 'AlertsTopic', {
      topicName: `parimaan-${envName}-alerts`,
    });
    this.createAuroraAlarms(dbCluster, this.alertsTopic);

    this.appRoleSecret = this.createAppRoleSecret();

    this.createMigrationRunner({
      vpc,
      dbCluster,
      dbSecret,
      appRoleSecret: this.appRoleSecret,
      lambdaSecurityGroup,
    });

    // dev is explicitly disposable/iterative (SYSTEM_DESIGN.md §12.1) — RETAIN
    // there just leaves orphaned, silently cost-accruing resources behind
    // every `cdk destroy`. prod holds real uploaded/exported user data, where
    // RETAIN is the correct protection against accidental deletion.
    const bucketRemovalPolicy =
      envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.uploadsBucket = new Bucket(this, 'UploadsBucket', {
      bucketName: `parimaan-uploads-${envName}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: bucketRemovalPolicy,
    });

    this.exportsBucket = new Bucket(this, 'ExportsBucket', {
      bucketName: `parimaan-exports-${envName}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: bucketRemovalPolicy,
      lifecycleRules: [{ enabled: true, expiration: cdk.Duration.days(30) }],
    });

    // Always DESTROY, regardless of env — this table holds only TTL-expiring
    // cache/rate-limit data (SYSTEM_DESIGN.md §7.3), never anything worth
    // retaining through a stack teardown in any environment.
    this.cacheTable = new Table(this, 'CacheTable', {
      tableName: `parimaan-cache-${envName}`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * Aurora's own security group (ingress added once `lambdaSecurityGroup`
   * exists) plus the security group shared by every VPC-attached Lambda
   * that needs to reach it. Both owned here — not in api-stack — to avoid
   * a circular CloudFormation stack dependency: api-stack already depends
   * on DataStack for the cluster endpoint/secret, so an ingress rule
   * authored in api-stack against this SG would make DataStack
   * export-depend on api-stack's SG id in turn. DataStack owns both sides
   * of the relationship instead.
   *
   * Returns the constructed groups rather than assigning `this.x` itself —
   * the constructor performs those assignments, so `readonly` fields stay
   * assigned in exactly one place `tsc` can see (`strictPropertyInitialization`
   * doesn't trace assignments made from inside a called private method).
   * Do not "helpfully" add a `this.lambdaSecurityGroup = ...` in here too.
   */
  private createSecurityGroups(vpc: IVpc): {
    dbSecurityGroup: SecurityGroup;
    lambdaSecurityGroup: SecurityGroup;
  } {
    const dbSecurityGroup = new SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Aurora Serverless v2 cluster',
      allowAllOutbound: true,
    });

    const lambdaSecurityGroup = new SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Shared security group for VPC-attached Lambdas reaching Aurora',
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      Port.tcp(5432),
      'VPC-attached Lambdas (resolvers, migration runner) reaching Aurora',
    );

    return { dbSecurityGroup, lambdaSecurityGroup };
  }

  /** Returns rather than self-assigns `this.dbCluster` — see the comment on `createSecurityGroups`. */
  private createAuroraCluster(
    vpc: IVpc,
    dbSecurityGroup: SecurityGroup,
  ): { dbCluster: DatabaseCluster; dbSecret: ISecret } {
    const dbCluster = new DatabaseCluster(this, 'AuroraCluster', {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_16_13,
      }),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      writer: ClusterInstance.serverlessV2('Writer'),
      // AWS only allows `serverlessV2AutoPauseDuration` when the minimum is
      // 0 — a non-zero minimum (e.g. 0.5) rejects auto-pause outright.
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      // Minimum allowed value (300s = 5 min) — cost discipline is the
      // explicit priority (PRD.md §17.4 lever #2, "non-negotiable"), so pause
      // as aggressively as AWS permits rather than picking a larger margin.
      serverlessV2AutoPauseDuration: cdk.Duration.minutes(5),
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
      credentials: Credentials.fromGeneratedSecret('parimaan_admin'),
      // Named explicitly rather than accepting the engine default
      // ("postgres") — the cluster hasn't been deployed to any real
      // environment yet, so this is free to set now and expensive (forces
      // cluster replacement) to change later.
      defaultDatabaseName: 'parimaan',
    });

    const dbSecret = dbCluster.secret;
    if (!dbSecret) {
      throw new Error(
        'DatabaseCluster.secret is undefined — expected Credentials.fromGeneratedSecret to always produce one.',
      );
    }
    return { dbCluster, dbSecret };
  }

  /**
   * Two alarms, both against the whole cluster (there is exactly one
   * `serverlessV2` writer instance — see `createAuroraCluster` — so a
   * cluster-level metric and an instance-level one are the same number here).
   *
   * **CPUUtilization** catches a resolver stuck in a hot loop or a query
   * missing an index — sustained high CPU with the low query volume this
   * app has pre-launch is itself the anomaly worth paging on, independent of
   * whether it ever causes a user-visible failure.
   *
   * **DatabaseConnections** exists specifically because there is no RDS
   * Proxy (locked decision, `SYSTEM_DESIGN.md` §7.1/E2E_MVP_PLAN.md §10 Q1):
   * every resolver Lambda opens its own connection, so nothing but the
   * connection ceiling itself limits how many can be open at once. The
   * threshold, 60, is chosen against `api-stack.ts`'s intended
   * `reservedConcurrentExecutions` (5 per DB-backed resolver Lambda × up to
   * 10 such resolvers = 50 possible concurrent connections at that cap) —
   * so 60 fires only if something is holding connections open longer than a
   * single invocation should (a leak), not from ordinary concurrent traffic
   * at the capacity those reservations already allow. It is deliberately
   * *not* set near Aurora's actual connection ceiling (~90 at the 2-ACU
   * `serverlessV2MaxCapacity` above): waiting for the hard ceiling would mean
   * this alarm and a user-visible `too many connections` failure fire at
   * roughly the same moment, which defeats the point of an early warning.
   *
   * Those reservations are not actually applied yet (see
   * `createDbResolverFunction`'s comment in api-stack.ts: today's account
   * concurrency quota is too low to accept any) — so this threshold is
   * currently sized for a ceiling the account can't reach anyway, not for
   * today's real (lower, quota-bounded) one. Left as-is rather than
   * temporarily lowered: the two are meant to be re-added together, and a
   * threshold that has to be remembered to change back is worse than one
   * that is simply inert for a while.
   */
  private createAuroraAlarms(dbCluster: DatabaseCluster, alertsTopic: Topic): void {
    const alarmAction = new SnsAction(alertsTopic);

    new Alarm(this, 'AuroraCpuAlarm', {
      alarmDescription: 'Aurora Serverless v2 sustained high CPU (parimaan-dev/prod)',
      metric: dbCluster.metricCPUUtilization({ period: cdk.Duration.minutes(5) }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      // A paused (0-ACU, auto-paused) cluster reports no CPU datapoints at
      // all, not zero — treating that as breaching would page on ordinary
      // idle-then-pause behavior, which is the opposite of an anomaly.
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    new Alarm(this, 'AuroraConnectionsAlarm', {
      alarmDescription: 'Aurora Serverless v2 connection count approaching a leak, not just load (parimaan-dev/prod)',
      metric: dbCluster.metricDatabaseConnections({ period: cdk.Duration.minutes(5) }),
      threshold: 60,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);
  }

  /**
   * Login password for the least-privileged `parimaan_app` Postgres role
   * (api/migrations/1787124517648_app-role.ts) — a separate secret from
   * the cluster's own admin-credentials secret, generated the same way
   * (never a literal). Returns rather than self-assigns `this.appRoleSecret`
   * — see the comment on `createSecurityGroups`.
   */
  private createAppRoleSecret(): Secret {
    return new Secret(this, 'AppRoleSecret', {
      description:
        'Login password for the parimaan_app least-privileged Postgres role (SD §6.2 layer 3 / RLS)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
  }

  /**
   * Runs `api/migrations/*` against Aurora as part of every `cdk deploy`,
   * via a CloudFormation custom resource — see
   * `api/src/migrationRunner/handler.ts` for the handler itself (never
   * runs on stack Delete; redacts secrets from node-pg-migrate's own
   * error-path logging). `node-pg-migrate` is left un-inlined via
   * `bundling.nodeModules` (real `npm install`, not esbuild-bundled)
   * because it loads migration files from disk at runtime via `jiti`,
   * which a single-file bundle would not preserve. The migrations
   * themselves are copied into the bundle output by `afterBundling` and
   * located via `MIGRATIONS_DIR` at runtime, since that bundled layout
   * doesn't match `runMigrations.ts`'s own source-relative default.
   */
  private createMigrationRunner(params: {
    vpc: IVpc;
    dbCluster: DatabaseCluster;
    dbSecret: ISecret;
    appRoleSecret: Secret;
    lambdaSecurityGroup: SecurityGroup;
  }): void {
    const { vpc, dbCluster, dbSecret, appRoleSecret, lambdaSecurityGroup } = params;
    const migrationsSourceDir = join(__dirname, '../../api/migrations');
    const migrationRunnerFn = new NodejsFunction(this, 'MigrationRunnerFn', {
      entry: join(__dirname, '../../api/src/migrationRunner/handler.ts'),
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSecurityGroup],
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        APP_ROLE_SECRET_ARN: appRoleSecret.secretArn,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_NAME: 'parimaan',
        MIGRATIONS_DIR: '/var/task/migrations',
      },
      bundling: createMigrationRunnerBundlingOptions(migrationsSourceDir),
    });

    dbSecret.grantRead(migrationRunnerFn);
    appRoleSecret.grantRead(migrationRunnerFn);

    const migrationProvider = new Provider(this, 'MigrationRunnerProvider', {
      onEventHandler: migrationRunnerFn,
    });

    const migrationTrigger = new cdk.CustomResource(this, 'MigrationRunnerTrigger', {
      serviceToken: migrationProvider.serviceToken,
      properties: {
        // Forces CloudFormation to re-invoke the migration runner whenever
        // a migration file changes — CFN only re-runs a custom resource
        // when its Properties differ from the last-deployed value.
        MigrationsHash: hashMigrationsDir(migrationsSourceDir),
      },
    });

    // `dbCluster.clusterEndpoint.hostname` only makes CloudFormation wait on
    // the `AWS::RDS::DBCluster` resource — the cluster endpoint's DNS record
    // is not guaranteed resolvable until the writer *instance*
    // (`AWS::RDS::DBInstance`, a separate resource `ClusterInstance
    // .serverlessV2('Writer')` creates as a child of `dbCluster`) has also
    // finished. Without this, the trigger can fire the moment the DBCluster
    // resource alone reports complete, invoking the migration Lambda before
    // the endpoint resolves at all: `getaddrinfo ENOTFOUND
    // <cluster>.cluster-....rds.amazonaws.com`, caught only by a real
    // deploy — no test exercises actual DNS resolution timing.
    // `addDependency` on the whole `dbCluster` construct (not just its top-
    // level DBCluster resource) walks its entire construct subtree and adds
    // a CloudFormation `DependsOn` for every resource found there, which is
    // what pulls the writer instance into the wait.
    migrationTrigger.node.addDependency(dbCluster);
  }
}
