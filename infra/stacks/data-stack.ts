import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
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
import { Provider } from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import { hashMigrationsDir } from '../lib/hashMigrationsDir';

/**
 * `api/src/db/runMigrations.ts` computes its default migrations path via
 * `import.meta.url` — esbuild's default CJS output format makes
 * `import.meta` empty, which would throw at Lambda cold-start the moment
 * that module is imported (before `MIGRATIONS_DIR`'s env-var override even
 * gets a chance to matter). ESM keeps `import.meta` meaningful; Node 24's
 * Lambda runtime supports it natively. `node-pg-migrate` is left
 * un-inlined via `nodeModules` (a real `npm install`, not esbuild-bundled)
 * because it loads migration files from disk at runtime via `jiti`, which
 * a single-file bundle would not preserve — the migrations themselves are
 * copied into the bundle output by `afterBundling`, at the location
 * `MIGRATIONS_DIR` (above) points the handler at.
 */
const createMigrationRunnerBundlingOptions = (migrationsSourceDir: string): BundlingOptions => ({
  format: OutputFormat.ESM,
  nodeModules: ['node-pg-migrate'],
  commandHooks: {
    beforeBundling: (): string[] => [],
    beforeInstall: (): string[] => [],
    afterBundling: (_inputDir: string, outputDir: string): string[] => [
      `cp -r "${migrationsSourceDir}" "${outputDir}/migrations"`,
    ],
  },
});

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
        version: AuroraPostgresEngineVersion.VER_16_4,
      }),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      writer: ClusterInstance.serverlessV2('Writer'),
      serverlessV2MinCapacity: 0.5,
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

    new cdk.CustomResource(this, 'MigrationRunnerTrigger', {
      serviceToken: migrationProvider.serviceToken,
      properties: {
        // Forces CloudFormation to re-invoke the migration runner whenever
        // a migration file changes — CFN only re-runs a custom resource
        // when its Properties differ from the last-deployed value.
        MigrationsHash: hashMigrationsDir(migrationsSourceDir),
      },
    });
  }
}
