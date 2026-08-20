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
  /** VPC from NetworkStack — every database-backed resolver Lambda needs it to reach Aurora. */
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
   * DynamoDB cache/rate-limit table from DataStack. Only the two
   * rate-limited mutations use it (per-caller daily counters — see
   * `api/src/rateLimit/dailyActionLimiter.ts`): `joinHousehold`, guarding
   * the invite code's ~887M-code keyspace against a scripted guesser, and
   * `rotateInviteCode`, whose abuse shape is a member denying every
   * co-member access. Granted to those two Lambdas specifically (via
   * `needsCacheTable` below), never to the other resolvers.
   */
  readonly cacheTable: Table;
}

/**
 * One VPC-attached, database-backed resolver Lambda and the single GraphQL
 * field it resolves. `id` doubles as the construct-id stem for all three
 * synthesized resources (`<id>Fn`, `<id>DataSource`, `<id>Resolver`), so it
 * is effectively a CloudFormation logical id — renaming one replaces the
 * Lambda rather than updating it.
 */
interface DbResolverEntry {
  readonly id: string;
  readonly entryFile: string;
  readonly typeName: string;
  readonly fieldName: string;
  /**
   * Grants `CACHE_TABLE_NAME` + a narrow `dynamodb:UpdateItem` on the shared
   * cache table. True ONLY for the rate-limited mutations — `joinHousehold`
   * (guessable invite-code keyspace) and `rotateInviteCode` (destructive for
   * co-members). Every other resolver must have no DynamoDB access at all.
   */
  readonly needsCacheTable?: boolean;
}

/**
 * The full set of database-backed resolvers, declared once and wired by a
 * single loop below — the per-Lambda `createDbResolverFunction` +
 * `wireResolver` + grant sequence is identical for every entry, so keeping it
 * as data rather than repeated statements is what makes adding a resolver a
 * one-line change (and keeps the wiring method under the 50-line
 * `max-lines-per-function` ceiling).
 */
const DB_RESOLVERS: readonly DbResolverEntry[] = [
  { id: 'Me', entryFile: 'me.ts', typeName: 'Query', fieldName: 'me' },
  {
    id: 'CreateHousehold',
    entryFile: 'createHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'createHousehold',
  },
  {
    id: 'UserHouseholds',
    entryFile: 'userHouseholds.ts',
    typeName: 'User',
    fieldName: 'households',
  },
  {
    id: 'JoinHousehold',
    entryFile: 'joinHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'joinHousehold',
    needsCacheTable: true,
  },
  {
    id: 'UpdateHouseholdSettings',
    entryFile: 'updateHouseholdSettings.ts',
    typeName: 'Mutation',
    fieldName: 'updateHouseholdSettings',
  },
  {
    id: 'RotateInviteCode',
    entryFile: 'rotateInviteCode.ts',
    typeName: 'Mutation',
    fieldName: 'rotateInviteCode',
    needsCacheTable: true,
  },
  {
    id: 'LeaveHousehold',
    entryFile: 'leaveHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'leaveHousehold',
  },
  {
    id: 'DeleteHousehold',
    entryFile: 'deleteHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'deleteHousehold',
  },
];

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
 *   behind it.
 * - `Mutation.rotateInviteCode`, `Mutation.leaveHousehold`,
 *   `Mutation.deleteHousehold` — household lifecycle. `rotateInviteCode` is
 *   member-gated and rate-limited (the second consumer of `cacheTable`);
 *   `leaveHousehold` is deliberately NOT `requireHouseholdMember`-gated,
 *   because "not a member" is its success state, not a denial;
 *   `deleteHousehold` is primary-only behind an exact-name confirmation and
 *   is the only path by which a household is ever destroyed.
 *
 * The `onHouseholdChanged`/`onHouseholdSettingsChanged` subscriptions are
 * deliberately deferred to W12, when a connect-time authorizer Lambda exists
 * (SD §10.4) — no `Subscription` type exists in `shared/schema.graphql` yet.
 *
 * Only `_health` stays out of the VPC (no DB access needed) — the other
 * eight are VPC-attached, connecting to Aurora as the least-privileged
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

    // Build-time config for the Flutter mobile app
    // (`mobile/lib/app/config/dev_config.dart` — see docs/RUNBOOK.md for the
    // transcription step). Not a secret: every request to this endpoint is
    // Cognito-authorized (`AuthorizationType.USER_POOL` above), so knowing
    // the URL grants nothing on its own. Nothing else from this stack is
    // exported — the Aurora endpoint, the app-role secret ARN, and the
    // Lambda security group are all server-side and must stay unexported.
    // Env-scoped because CloudFormation export names are unique per
    // account+region.
    new cdk.CfnOutput(this, 'GraphQlUrl', {
      value: this.api.graphqlUrl,
      description: 'AppSync GraphQL endpoint URL for the mobile app build-time config.',
      exportName: `Parimaan-${envName}-GraphQlUrl`,
    });
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

    for (const entry of DB_RESOLVERS) {
      const fn = this.createDbResolverFunction(`${entry.id}Fn`, entry.entryFile, dbDeps);

      // Only the rate-limited resolvers get the cache table, and only the one
      // DynamoDB action their limiter actually calls (a single atomic
      // increment-with-cap — api/src/rateLimit/dailyActionLimiter.ts). Not
      // the broader `grantWriteData`/`grantReadData` CDK convenience grants,
      // which would include Put/Delete/BatchWrite/Query/Scan these Lambdas
      // never use. Applied generically here so a future limited resolver
      // cannot accidentally get a wider grant by copy-paste.
      if (entry.needsCacheTable === true) {
        fn.addEnvironment('CACHE_TABLE_NAME', cacheTable.tableName);
        cacheTable.grant(fn, 'dynamodb:UpdateItem');
      }

      this.wireResolver(entry.id, fn, entry.typeName, entry.fieldName);
    }
  }

  /** Adds a Lambda data source and its resolver for one GraphQL field, sharing the `<Name>DataSource`/`<Name>Resolver` logical-id convention every resolver in this stack already follows. */
  private wireResolver(name: string, fn: NodejsFunction, typeName: string, fieldName: string): void {
    const dataSource = this.api.addLambdaDataSource(`${name}DataSource`, fn);
    dataSource.createResolver(`${name}Resolver`, { typeName, fieldName });
  }

  /**
   * Shared config for every database-backed resolver Lambda in
   * `DB_RESOLVERS`: VPC subnet placement, the shared
   * `lambdaSecurityGroup`, and env vars for
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
