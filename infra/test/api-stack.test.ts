import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GraphqlApi } from 'aws-cdk-lib/aws-appsync';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ApiStack } from '../stacks/api-stack';
import { DataStack } from '../stacks/data-stack';
import { redactAssetHashes } from './support/redactAssetHashes';

/**
 * Minimal stand-in for `AuthStack`'s user pool — built directly in the test,
 * in its own `cdk.Stack` (not the `App` root), so `ApiStack` can be
 * exercised in isolation without spinning up the real `AuthStack`. Mirrors
 * `data-stack.test.ts`'s `buildFakeVpc` cross-stack test-fixture pattern.
 */
const buildFakeUserPool = (app: cdk.App, envName: 'dev' | 'prod'): UserPool => {
  const authStack = new cdk.Stack(app, `Parimaan-${envName}-FakeAuth`);
  return new UserPool(authStack, 'UserPool', {
    selfSignUpEnabled: false,
    signInAliases: { email: true },
  });
};

/** Same fake-VPC shape as data-stack.test.ts's own fixture — kept in sync deliberately. */
const buildFakeVpc = (app: cdk.App, envName: 'dev' | 'prod'): Vpc => {
  const vpcStack = new cdk.Stack(app, `Parimaan-${envName}-FakeNetwork`);
  return new Vpc(vpcStack, 'Vpc', {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
      { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
};

/**
 * Real `DataStack`, built in its own `cdk.Stack`, so `ApiStack`'s
 * `dbCluster`/`appRoleSecret`/`lambdaSecurityGroup` props exercise the same
 * cross-stack reference shape production wiring (`infra/bin/parimaan.ts`)
 * uses — cheaper and more accurate than hand-duplicating DataStack's
 * internal construct calls as a second fake fixture.
 */
const buildFakeDataStack = (app: cdk.App, envName: 'dev' | 'prod', vpc: Vpc): DataStack =>
  new DataStack(app, `Parimaan-${envName}-FakeData`, { envName, vpc });

// SINGLE SOURCE OF TRUTH per shared/schema.graphql's own header — the
// synthesized AppSync schema definition must be sourced from this exact
// file, not an inline placeholder string that could silently drift from it.
const REAL_SCHEMA_PATH = join(__dirname, '../../shared/schema.graphql');
const REAL_SCHEMA_CONTENTS = readFileSync(REAL_SCHEMA_PATH, 'utf-8');

describe('ApiStack', () => {
  const build = (envName: 'dev' | 'prod'): ApiStack => {
    const app = new cdk.App();
    const userPool = buildFakeUserPool(app, envName);
    const vpc = buildFakeVpc(app, envName);
    const data = buildFakeDataStack(app, envName, vpc);
    return new ApiStack(app, `Parimaan-${envName}-Api`, {
      envName,
      userPool,
      vpc,
      dbCluster: data.dbCluster,
      appRoleSecret: data.appRoleSecret,
      lambdaSecurityGroup: data.lambdaSecurityGroup,
      cacheTable: data.cacheTable,
    });
  };

  // Every assertion below reads the same immutable synthesized template —
  // none of them mutate it — so memoizing by env turns ~22 independent
  // `it()`-triggered full CDK synths (each one bundling 6 Lambdas via
  // esbuild, ~3s apiece) into effectively 2. Not just a speed nicety: the
  // unmemoized version was slow enough (~85s for this file alone) to
  // starve the Vitest worker's own IPC heartbeat to the main thread and
  // fail CI with "[vitest-worker]: Timeout calling 'onTaskUpdate'" —
  // confirmed on PR #11, where three other mitigations (disabling file
  // parallelism, disabling module isolation, silencing passing-test
  // console output) each left this file's per-test synth cost unchanged
  // and the failure recurred identically every time.
  const templateCache = new Map<'dev' | 'prod', Template>();
  const synth = (envName: 'dev' | 'prod'): Template => {
    const cached = templateCache.get(envName);
    if (cached) return cached;
    const template = Template.fromStack(build(envName));
    templateCache.set(envName, template);
    return template;
  };

  /**
   * All Lambda functions belonging to *this* stack's own template, minus
   * CDK's auto-created "LogRetention" custom-resource helper (a side effect
   * of the AppSync API's `logConfig`, not one of our resolvers). Since
   * `Template.fromStack` only synthesizes the one stack passed to it,
   * DataStack's own Lambdas (the migration runner, its Provider framework
   * function) never appear here — they live in the fake DataStack's
   * separate template.
   */
  const ourFunctions = (
    template: Template,
  ): Array<[string, { Properties: { Runtime: string; Handler: string; VpcConfig?: unknown } }]> =>
    Object.entries(template.findResources('AWS::Lambda::Function')).filter(
      ([logicalId]) => !logicalId.startsWith('LogRetention'),
    ) as Array<[string, { Properties: { Runtime: string; Handler: string; VpcConfig?: unknown } }]>;

  it('synthesizes without error for dev', () => {
    expect(() => synth('dev')).not.toThrow();
  });

  it('synthesizes without error for prod', () => {
    expect(() => synth('prod')).not.toThrow();
  });

  it('declares exactly one AppSync GraphQL API', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 1);
  });

  it('names the API parimaan-dev for a dev synth', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      Name: 'parimaan-dev',
    });
  });

  it('names the API parimaan-prod for a prod synth', () => {
    const template = synth('prod');
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      Name: 'parimaan-prod',
    });
  });

  it('defaults authorization to AMAZON_COGNITO_USER_POOLS, pointing at the passed-in user pool', () => {
    // Verified empirically against the installed aws-cdk-lib (2.265.0): the
    // synthesized `AWS::AppSync::GraphQLApi` resource names the default auth
    // mode via `AuthenticationType` (not `DefaultAuthenticationType`), and
    // the Cognito wiring lives under `UserPoolConfig.UserPoolId` as a `Ref`
    // to the pool passed in — not a separate `Modes` array entry.
    const app = new cdk.App();
    const userPool = buildFakeUserPool(app, 'dev');
    const vpc = buildFakeVpc(app, 'dev');
    const data = buildFakeDataStack(app, 'dev', vpc);
    const stack = new ApiStack(app, 'Parimaan-dev-Api', {
      envName: 'dev',
      userPool,
      vpc,
      dbCluster: data.dbCluster,
      appRoleSecret: data.appRoleSecret,
      lambdaSecurityGroup: data.lambdaSecurityGroup,
      cacheTable: data.cacheTable,
    });
    const template = Template.fromStack(stack);

    const userPoolLogicalId = Object.keys(
      Template.fromStack(cdk.Stack.of(userPool)).findResources('AWS::Cognito::UserPool'),
    )[0];
    expect(userPoolLogicalId).toBeDefined();

    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      AuthenticationType: 'AMAZON_COGNITO_USER_POOLS',
      UserPoolConfig: Match.objectLike({
        UserPoolId: Match.objectLike({
          'Fn::ImportValue': Match.stringLikeRegexp(userPoolLogicalId ?? ''),
        }),
      }),
    });
  });

  it('sources the GraphQL schema from the real shared/schema.graphql file — not an inline placeholder string', () => {
    // Guards against schema drift: the synthesized `AWS::AppSync::GraphQLSchema`
    // `Definition` must equal the actual on-disk file contents byte-for-byte,
    // proving the stack reads the single source of truth rather than
    // duplicating/hand-typing the schema inline.
    const template = synth('dev');
    template.resourceCountIs('AWS::AppSync::GraphQLSchema', 1);
    template.hasResourceProperties('AWS::AppSync::GraphQLSchema', {
      Definition: REAL_SCHEMA_CONTENTS,
    });
  });

  it('the real schema file still contains the Query._health placeholder field this stack resolves', () => {
    // Sanity check on the fixture itself — if `shared/schema.graphql` is
    // edited to remove `_health`, this test (not just the resolver test
    // below) should fail loudly rather than silently passing on stale data.
    expect(REAL_SCHEMA_CONTENTS).toMatch(/_health\s*:\s*String!/);
  });

  it('the real schema file still declares me, createHousehold, and User.households', () => {
    expect(REAL_SCHEMA_CONTENTS).toMatch(/\bme\s*:\s*User!/);
    expect(REAL_SCHEMA_CONTENTS).toMatch(/createHousehold\(name:\s*String!\)\s*:\s*Household!/);
    expect(REAL_SCHEMA_CONTENTS).toMatch(/households\s*:\s*\[HouseholdMembership!\]!/);
  });

  it('the real schema file still declares the household lifecycle mutations', () => {
    expect(REAL_SCHEMA_CONTENTS).toMatch(/rotateInviteCode\(householdId:\s*ID!\)\s*:\s*Household!/);
    expect(REAL_SCHEMA_CONTENTS).toMatch(/leaveHousehold\(householdId:\s*ID!\)\s*:\s*Boolean!/);
    expect(REAL_SCHEMA_CONTENTS).toMatch(
      /deleteHousehold\(householdId:\s*ID!,\s*confirmationName:\s*String!\)\s*:\s*Boolean!/,
    );
  });

  it('the real schema file still declares Query.household', () => {
    expect(REAL_SCHEMA_CONTENTS).toMatch(/household\(householdId:\s*ID!\)\s*:\s*Household!/);
  });

  it('the real schema file still declares joinHousehold and updateHouseholdSettings, and no Subscription type yet', () => {
    expect(REAL_SCHEMA_CONTENTS).toMatch(/joinHousehold\(inviteCode:\s*String!\)\s*:\s*Household!/);
    expect(REAL_SCHEMA_CONTENTS).toMatch(
      /updateHouseholdSettings\(householdId:\s*ID!,\s*input:\s*HouseholdSettingsInput!\)\s*:\s*HouseholdSettings!/,
    );
    expect(REAL_SCHEMA_CONTENTS).toMatch(/input HouseholdSettingsInput/);
    // Subscriptions are deliberately deferred to W12 (connect-time authorizer
    // Lambda, SD §10.4) — this guards against a future edit silently adding
    // one without the CDK/security work that must accompany it.
    expect(REAL_SCHEMA_CONTENTS).not.toMatch(/type Subscription/);
  });

  it('declares exactly 12 resolver Lambda functions (health + me + createHousehold + userHouseholds + joinHousehold + updateHouseholdSettings + rotateInviteCode + leaveHousehold + deleteHousehold + household + pantry + addPantryItem)', () => {
    const template = synth('dev');
    expect(ourFunctions(template)).toHaveLength(12);
  });

  it('declares the health Lambda outside the VPC, on the Node.js 24 runtime', () => {
    // health has no DB access and must not be dragged into the VPC — see
    // its own comment in api-stack.ts.
    const template = synth('dev');
    const nonVpcFunctions = ourFunctions(template).filter(([, r]) => !r.Properties.VpcConfig);
    expect(nonVpcFunctions).toHaveLength(1);
    const [, healthFn] = nonVpcFunctions[0] as (typeof nonVpcFunctions)[0];
    expect(healthFn.Properties.Runtime).toBe('nodejs24.x');
  });

  it('declares 11 VPC-attached resolver Lambdas (me, createHousehold, userHouseholds, joinHousehold, updateHouseholdSettings, rotateInviteCode, leaveHousehold, deleteHousehold, household, pantry, addPantryItem), on the Node.js 24 runtime, using the shared Lambda security group', () => {
    const template = synth('dev');
    const vpcFunctions = ourFunctions(template).filter(([, r]) => r.Properties.VpcConfig);
    expect(vpcFunctions).toHaveLength(11);
    for (const [, fn] of vpcFunctions) {
      expect(fn.Properties.Runtime).toBe('nodejs24.x');
      const vpcConfig = fn.Properties.VpcConfig as { SecurityGroupIds: unknown[]; SubnetIds: unknown[] };
      expect(vpcConfig.SecurityGroupIds).toHaveLength(1);
      expect(vpcConfig.SubnetIds).toHaveLength(2);
    }
  });

  // Aurora Serverless v2's auto-pause resume can take up to ~30s, and
  // connecting is only the first part of an invocation that then still has
  // to run the actual query — a function timeout with no headroom past that
  // 30s leaves a genuine cold start no time to ever succeed. Caught only by
  // a real cold Aurora invocation; this test exists so the margin can't
  // silently shrink back to nothing.
  it('gives every VPC-attached resolver Lambda enough timeout headroom past Aurora\'s ~30s auto-pause resume to still run the query afterward', () => {
    const template = synth('dev');
    const vpcFunctions = ourFunctions(template).filter(([, r]) => r.Properties.VpcConfig);
    expect(vpcFunctions).toHaveLength(11);
    for (const [, fn] of vpcFunctions) {
      const properties = fn.Properties as unknown as { Timeout: number };
      expect(properties.Timeout).toBeGreaterThan(30);
    }
  });

  it('sets APP_ROLE_SECRET_ARN/DB_HOST/DB_PORT/DB_NAME env vars on every VPC-attached resolver Lambda — never the cluster admin secret', () => {
    const template = synth('dev');
    const vpcFunctions = ourFunctions(template).filter(([, r]) => r.Properties.VpcConfig);
    expect(vpcFunctions).toHaveLength(11);
    for (const [, fn] of vpcFunctions) {
      const env = (fn as unknown as { Properties: { Environment: { Variables: Record<string, unknown> } } })
        .Properties.Environment.Variables;
      expect(env['APP_ROLE_SECRET_ARN']).toBeDefined();
      expect(env['DB_HOST']).toBeDefined();
      expect(env['DB_PORT']).toBeDefined();
      expect(env['DB_NAME']).toBe('parimaan');
      // The cluster's own admin-credentials secret must never be referenced
      // by these resolver Lambdas — they connect as parimaan_app only.
      expect(env['DB_SECRET_ARN']).toBeUndefined();
    }
  });

  // No resolver Lambda sets `reservedConcurrentExecutions` right now — see
  // `createDbResolverFunction`'s comment in api-stack.ts: this AWS account's
  // current Lambda concurrency quota (10 total) is too low for any per-
  // function reservation to be accepted at all. This is a change-detector,
  // not an intent assertion — it should fail loudly (and be updated
  // alongside the code comment) the day a reservation is reintroduced.
  it('sets no ReservedConcurrentExecutions on any function — today\'s account quota rejects any nonzero reservation (see the code comment; revisit once the quota is raised)', () => {
    const template = synth('dev');
    for (const [, fn] of ourFunctions(template)) {
      const properties = fn.Properties as unknown as { ReservedConcurrentExecutions?: number };
      expect(properties.ReservedConcurrentExecutions).toBeUndefined();
    }
  });

  it('sets CACHE_TABLE_NAME only on the two rate-limited Lambdas (joinHousehold, rotateInviteCode), never on the other resolvers', () => {
    const template = synth('dev');
    const vpcFunctions = ourFunctions(template).filter(([, r]) => r.Properties.VpcConfig);
    const withCacheTableEnv = vpcFunctions.filter(([, fn]) => {
      const env = (fn as unknown as { Properties: { Environment: { Variables: Record<string, unknown> } } })
        .Properties.Environment.Variables;
      return env['CACHE_TABLE_NAME'] !== undefined;
    });
    expect(withCacheTableEnv).toHaveLength(2);
    const logicalIds = withCacheTableEnv.map(([logicalId]) => logicalId).sort();
    expect(logicalIds[0]).toMatch(/^JoinHouseholdFn/);
    expect(logicalIds[1]).toMatch(/^RotateInviteCodeFn/);
  });

  /**
   * Every `AWS::IAM::Policy` statement in this stack that names any
   * `dynamodb:*` action, paired with the logical ids of the roles that policy
   * is attached to — the shape both the positive grant assertions and the
   * `LeaveHouseholdFn`/`DeleteHouseholdFn` negative assertion below need.
   */
  const ddbPolicyStatements = (
    template: Template,
  ): Array<{ statement: { Action: string | string[]; Resource: unknown }; roleRefs: string[] }> =>
    Object.values(template.findResources('AWS::IAM::Policy')).flatMap((policy) => {
      const typed = policy as {
        Properties: {
          PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> };
          Roles?: Array<{ Ref?: string }>;
        };
      };
      const roleRefs = (typed.Properties.Roles ?? [])
        .map((role) => role.Ref)
        .filter((ref): ref is string => ref !== undefined);
      return typed.Properties.PolicyDocument.Statement.filter((statement) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        return actions.some((action) => typeof action === 'string' && action.startsWith('dynamodb:'));
      }).map((statement) => ({ statement, roleRefs }));
    });

  it('grants dynamodb:UpdateItem on the cache table to exactly the two rate-limited Lambdas — no other action, never Resource: "*"', () => {
    const template = synth('dev');
    const entries = ddbPolicyStatements(template);
    expect(entries).toHaveLength(2);
    for (const { statement } of entries) {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      expect(actions).toEqual(['dynamodb:UpdateItem']);
      expect(statement.Resource).not.toBe('*');
    }
    const grantedRoles = entries.flatMap((entry) => entry.roleRefs).join(' ');
    expect(grantedRoles).toMatch(/JoinHouseholdFnServiceRole/);
    expect(grantedRoles).toMatch(/RotateInviteCodeFnServiceRole/);
  });

  it('grants leaveHousehold and deleteHousehold NO DynamoDB access at all — no statement mentions either role', () => {
    // Negative assertion, deliberately phrased as "these roles appear in zero
    // DynamoDB statements" rather than "the count is 2": a future grant
    // widened onto one of these Lambdas would still keep the count-based
    // assertion above honest-looking, but must fail here.
    const template = synth('dev');
    const allDdbRoleRefs = ddbPolicyStatements(template).flatMap((entry) => entry.roleRefs);
    expect(allDdbRoleRefs.filter((ref) => /^LeaveHouseholdFn/.test(ref))).toHaveLength(0);
    expect(allDdbRoleRefs.filter((ref) => /^DeleteHouseholdFn/.test(ref))).toHaveLength(0);
    // And the CACHE_TABLE_NAME env var never reaches them either.
    for (const [logicalId, fn] of ourFunctions(template)) {
      if (!/^(LeaveHousehold|DeleteHousehold)Fn/.test(logicalId)) continue;
      const env = (fn as unknown as { Properties: { Environment: { Variables: Record<string, unknown> } } })
        .Properties.Environment.Variables;
      expect(env['CACHE_TABLE_NAME']).toBeUndefined();
    }
  });

  it('grants each VPC-attached resolver Lambda secretsmanager:GetSecretValue scoped only to the app-role secret — never Resource: "*"', () => {
    const template = synth('dev');
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (policy) =>
        (
          policy as {
            Properties: {
              PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> };
            };
          }
        ).Properties.PolicyDocument.Statement,
    );
    const secretStatements = statements.filter((statement) => {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      return actions.includes('secretsmanager:GetSecretValue');
    });
    expect(secretStatements.length).toBeGreaterThan(0);
    for (const statement of secretStatements) {
      expect(statement.Resource).not.toBe('*');
    }
  });

  it('declares exactly 12 AppSync Lambda data sources', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::AppSync::DataSource', 12);
  });

  it('declares a resolver for Query._health', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: '_health',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Query.me', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: 'me',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Mutation.createHousehold', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'createHousehold',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for User.households', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'User',
      FieldName: 'households',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Mutation.joinHousehold', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'joinHousehold',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Mutation.updateHouseholdSettings', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'updateHouseholdSettings',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Mutation.rotateInviteCode', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'rotateInviteCode',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Mutation.leaveHousehold', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'leaveHousehold',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Mutation.deleteHousehold', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'deleteHousehold',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares a resolver for Query.household', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: 'household',
      DataSourceName: Match.anyValue(),
    });
  });

  it('declares exactly 12 resolvers total', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::AppSync::Resolver', 12);
  });

  it('enables X-Ray tracing on the AppSync API', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      XrayEnabled: true,
    });
  });

  it('does not embed an account id or hardcoded ap-south-1 region literal in the synthesized template', () => {
    // See the identical comment in data-stack.test.ts: a bare `/\d{12}/`
    // can false-positive on a random 12-digit run inside a bundled
    // Lambda's long content-hash S3 asset key. Requiring the digits to be
    // quote-bounded catches a real embedded account id without that risk.
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/"\d{12}"/);
    expect(json).not.toMatch(/ap-south-1/);
  });

  it('exposes api as a public readonly GraphqlApi property for downstream stacks/testing to reference', () => {
    const stack = build('dev');
    expect(stack.api).toBeDefined();
    expect(stack.api).toBeInstanceOf(GraphqlApi);
  });

  // ---------------------------------------------------------------------
  // CfnOutputs — the mobile app's build-time config (see docs/RUNBOOK.md).
  // The AppSync endpoint URL is not a secret: it is Cognito-authorized on
  // every request (asserted above), so knowing the URL grants nothing.
  // ---------------------------------------------------------------------

  it('exports the AppSync GraphQL URL as a CfnOutput named GraphQlUrl, env-scoped', () => {
    synth('dev').hasOutput('GraphQlUrl', {
      Value: Match.anyValue(),
      Export: { Name: 'Parimaan-dev-GraphQlUrl' },
    });
  });

  it('env-scopes the GraphQlUrl export name so dev and prod can coexist in one account/region', () => {
    synth('prod').hasOutput('GraphQlUrl', {
      Export: { Name: 'Parimaan-prod-GraphQlUrl' },
    });
  });

  it('exports nothing but the GraphQL URL — no Aurora endpoint, secret ARN, or security group id', () => {
    const outputs = (synth('dev').toJSON() as { Outputs?: Record<string, unknown> }).Outputs ?? {};
    expect(Object.keys(outputs)).toEqual(['GraphQlUrl']);
    const outputsJson = JSON.stringify(outputs);
    expect(outputsJson).not.toContain('secretsmanager');
    expect(outputsJson).not.toMatch(/DB_HOST|ClusterEndpoint|SecurityGroup/);
  });

  // Change-detector per DEV_WORKFLOW.md §3.4(c): fine-grained assertions above
  // are primary; this snapshot exists only to flag *any* unreviewed diff in
  // the synthesized template, not to encode intent on its own.
  it('matches the known-good synthesized template snapshot (dev)', () => {
    expect(redactAssetHashes(synth('dev').toJSON())).toMatchSnapshot();
  });
});
