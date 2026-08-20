import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import {
  AuthorizationType,
  Definition,
  FieldLogLevel,
  GraphqlApi,
} from 'aws-cdk-lib/aws-appsync';
import type { IUserPool, UserPool } from 'aws-cdk-lib/aws-cognito';
import type { ISecurityGroup, IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds';
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
  /**
   * User pool from AuthStack — ApiStack does not create its own.
   * Typed as the concrete `UserPool` class (matching `AuthStack.userPool`'s
   * type), not `IUserPool` — same `exactOptionalPropertyTypes` friction as
   * `NetworkStack.vpc` → `DataStack`, same narrow documented-cast fix below.
   */
  readonly userPool: UserPool;
  /** VPC from NetworkStack — the `me`/`createHousehold` resolver Lambdas need it to reach Aurora. */
  readonly vpc: Vpc;
  /** Aurora cluster from DataStack — only its endpoint (host/port) is used; credentials come from `appRoleSecret`, not the cluster's own admin secret. */
  readonly dbCluster: DatabaseCluster;
  /**
   * Login-password secret for the least-privileged `parimaan_app` Postgres
   * role, from DataStack. Typed as the concrete `Secret` class (matching
   * `DataStack.appRoleSecret`'s type), not `ISecret` — same
   * `exactOptionalPropertyTypes` friction as `vpc`/`userPool` above.
   */
  readonly appRoleSecret: Secret;
  /** Shared security group for VPC-attached Lambdas reaching Aurora, from DataStack. */
  readonly lambdaSecurityGroup: ISecurityGroup;
  /**
   * DynamoDB cache/rate-limit table from DataStack. Only `joinHousehold`
   * uses it (per-caller daily join-attempt counter, guarding the invite
   * code's ~887M-code keyspace against a scripted guessing script — see
   * `api/src/rateLimit/joinAttemptLimiter.ts`) — granted to that one
   * Lambda specifically, not the other resolvers.
   */
  readonly cacheTable: Table;
}

/**
 * AppSync GraphQL API, Cognito-authorized. Resolvers:
 * - `Query._health` — W1 placeholder, proves the AppSync → Lambda →
 *   response pipeline end-to-end (SYSTEM_DESIGN.md §6.1-§6.3).
 * - `Query.me`, `Mutation.createHousehold`, `User.households` — the first
 *   real slice (SYSTEM_DESIGN.md §5.1-§5.2), landing W3/W4 per
 *   E2E_MVP_PLAN.md §4. `User.households` is its own field resolver
 *   (rather than `me` returning a hydrated tree) specifically to avoid the
 *   User↔HouseholdMembership↔User schema cycle failing on a non-null field
 *   at arbitrary query depth.
 * - `Mutation.joinHousehold`, `Mutation.updateHouseholdSettings` — the rest
 *   of the W4 milestone. `joinHousehold` deliberately has no
 *   `requireHouseholdMember` gate (the caller isn't a member yet — that's
 *   the point) and is rate-limited via DynamoDB (`cacheTable`) against its
 *   guessable invite-code keyspace; `updateHouseholdSettings` is the first
 *   resolver in this codebase gated by `requireHouseholdMember` (SD §6.2
 *   layer 2), with RLS on `household_settings` as layer-3 defense-in-depth
 *   behind it. The `onHouseholdChanged`/`onHouseholdSettingsChanged`
 *   subscriptions are deliberately deferred to W12, when a connect-time
 *   authorizer Lambda exists (SD §10.4) — no `Subscription` type exists in
 *   `shared/schema.graphql` yet.
 *
 * Only `_health` stays out of the VPC (no DB access needed) — the other
 * five are VPC-attached, connecting to Aurora as the least-privileged
 * `parimaan_app` role (never the cluster's admin credentials).
 */
export class ApiStack extends cdk.Stack {
  public readonly api: GraphqlApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { envName } = props;
    // Same aws-cdk-lib type-declaration quirk as data-stack.ts's `vpc` cast —
    // `UserPool` implements every member `IUserPool` needs at runtime; this
    // is purely an `exactOptionalPropertyTypes` structural-mismatch artifact.
    const userPool = props.userPool as IUserPool;

    this.api = new GraphqlApi(this, 'Api', {
      name: `parimaan-${envName}`,
      definition: Definition.fromFile(join(__dirname, '../../shared/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
      xrayEnabled: true,
      logConfig: { fieldLogLevel: FieldLogLevel.ERROR },
    });

    this.createHealthResolver();
    this.createHouseholdResolvers(props);
  }

  private createHealthResolver(): void {
    const healthFn = new NodejsFunction(this, 'HealthFn', {
      entry: join(__dirname, '../../api/src/resolvers/health.ts'),
      // Lambda RUNTIME only — local dev tooling (.nvmrc, pnpm, CI) stays on
      // Node 20 by deliberate choice. nodejs20.x was confirmed already
      // deprecated by AWS (CFN validation warning: deprecated 2026-04-30,
      // new-resource creation disabled 2027-02-01); bumped now while only
      // one Lambda exists, per AWS's own suggested target in that warning.
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
    });

    const healthDataSource = this.api.addLambdaDataSource('HealthDataSource', healthFn);
    healthDataSource.createResolver('HealthResolver', {
      typeName: 'Query',
      fieldName: '_health',
    });
  }

  private createHouseholdResolvers(props: ApiStackProps): void {
    const { dbCluster, appRoleSecret, lambdaSecurityGroup, cacheTable } = props;
    // Same `exactOptionalPropertyTypes` quirk as data-stack.ts's `vpc` cast —
    // `Vpc` implements every member `IVpc` needs at runtime.
    const vpc = props.vpc as IVpc;
    const dbDeps = { vpc, dbCluster, appRoleSecret, lambdaSecurityGroup };

    const meFn = this.createDbResolverFunction('MeFn', 'me.ts', dbDeps);
    const createHouseholdFn = this.createDbResolverFunction(
      'CreateHouseholdFn',
      'createHousehold.ts',
      dbDeps,
    );
    const userHouseholdsFn = this.createDbResolverFunction(
      'UserHouseholdsFn',
      'userHouseholds.ts',
      dbDeps,
    );
    const joinHouseholdFn = this.createDbResolverFunction('JoinHouseholdFn', 'joinHousehold.ts', dbDeps);
    const updateHouseholdSettingsFn = this.createDbResolverFunction(
      'UpdateHouseholdSettingsFn',
      'updateHouseholdSettings.ts',
      dbDeps,
    );

    // Only joinHousehold needs the cache table (its per-caller daily
    // join-attempt rate limiter — api/src/rateLimit/joinAttemptLimiter.ts).
    // Granted narrowly to `dynamodb:UpdateItem` only — that's the only
    // DynamoDB action the limiter's code ever calls (a single atomic
    // increment-with-cap), not the broader `grantWriteData`/`grantReadData`
    // CDK convenience grants, which would include Put/Delete/BatchWrite/
    // Query/Scan this Lambda never uses.
    joinHouseholdFn.addEnvironment('CACHE_TABLE_NAME', cacheTable.tableName);
    cacheTable.grant(joinHouseholdFn, 'dynamodb:UpdateItem');

    this.wireResolver('Me', meFn, 'Query', 'me');
    this.wireResolver('CreateHousehold', createHouseholdFn, 'Mutation', 'createHousehold');
    this.wireResolver('UserHouseholds', userHouseholdsFn, 'User', 'households');
    this.wireResolver('JoinHousehold', joinHouseholdFn, 'Mutation', 'joinHousehold');
    this.wireResolver(
      'UpdateHouseholdSettings',
      updateHouseholdSettingsFn,
      'Mutation',
      'updateHouseholdSettings',
    );
  }

  /** Adds a Lambda data source and its resolver for one GraphQL field, sharing the `<Name>DataSource`/`<Name>Resolver` logical-id convention every resolver in this stack already follows. */
  private wireResolver(name: string, fn: NodejsFunction, typeName: string, fieldName: string): void {
    const dataSource = this.api.addLambdaDataSource(`${name}DataSource`, fn);
    dataSource.createResolver(`${name}Resolver`, { typeName, fieldName });
  }

  /**
   * Shared config for the three household-slice resolver Lambdas: VPC
   * subnet placement, the shared `lambdaSecurityGroup`, and env vars for
   * connecting to Aurora as `parimaan_app` (never the cluster's admin
   * secret — these Lambdas only ever get read access to `appRoleSecret`).
   */
  private createDbResolverFunction(
    id: string,
    entryFile: string,
    deps: {
      vpc: IVpc;
      dbCluster: DatabaseCluster;
      appRoleSecret: Secret;
      lambdaSecurityGroup: ISecurityGroup;
    },
  ): NodejsFunction {
    const { vpc, dbCluster, appRoleSecret, lambdaSecurityGroup } = deps;

    const fn = new NodejsFunction(this, id, {
      entry: join(__dirname, `../../api/src/resolvers/${entryFile}`),
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSecurityGroup],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      environment: {
        APP_ROLE_SECRET_ARN: appRoleSecret.secretArn,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_NAME: 'parimaan',
      },
    });

    appRoleSecret.grantRead(fn);
    return fn;
  }
}
