import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ApiStack } from '../stacks/api-stack';
import { DataStack } from '../stacks/data-stack';

/**
 * W17 S6 (`E2E_MVP_PLAN.md` §23.2.8, D8) — `exportShoppingListImage`'s own
 * infra assertions, split out of `api-stack.test.ts` purely to keep that
 * file under this repo's `max-lines` ESLint ceiling (the same reason
 * `resolverEntries.ts` was extracted out of `api-stack.ts` itself — no
 * behavior difference, just file size). Duplicates `api-stack.test.ts`'s
 * own fake-user-pool/fake-VPC/fake-DataStack fixtures rather than importing
 * them (they are not exported) — the same "own throwaway fixture per file"
 * convention `dbResolver.test.ts`/`nonVpcResolver.test.ts` already use.
 */
const buildFakeUserPool = (app: cdk.App): UserPool => {
  const authStack = new cdk.Stack(app, 'Parimaan-dev-FakeAuth');
  return new UserPool(authStack, 'UserPool', {
    selfSignUpEnabled: false,
    signInAliases: { email: true },
  });
};

const buildFakeVpc = (app: cdk.App): Vpc => {
  const vpcStack = new cdk.Stack(app, 'Parimaan-dev-FakeNetwork');
  return new Vpc(vpcStack, 'Vpc', {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
      { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      { name: 'private-egress', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
    ],
  });
};

const buildFakeDataStack = (app: cdk.App, vpc: Vpc): DataStack =>
  new DataStack(app, 'Parimaan-dev-FakeData', { envName: 'dev', vpc });

const ourFunctions = (
  template: Template,
): Array<[string, { Properties: { VpcConfig?: unknown; Environment?: { Variables: Record<string, unknown> } } }]> =>
  Object.entries(template.findResources('AWS::Lambda::Function')).filter(
    ([logicalId]) => !logicalId.startsWith('LogRetention'),
  ) as Array<[string, { Properties: { VpcConfig?: unknown; Environment?: { Variables: Record<string, unknown> } } }]>;

describe('ApiStack — Mutation.exportShoppingListImage (W17 S6, D8)', () => {
  const synth = (): Template => {
    const app = new cdk.App();
    const userPool = buildFakeUserPool(app);
    const vpc = buildFakeVpc(app);
    const data = buildFakeDataStack(app, vpc);
    const stack = new ApiStack(app, 'Parimaan-dev-Api', {
      envName: 'dev',
      userPool,
      vpc,
      dbCluster: data.dbCluster,
      appRoleSecret: data.appRoleSecret,
      lambdaSecurityGroup: data.lambdaSecurityGroup,
      cacheTable: data.cacheTable,
      exportsBucket: data.exportsBucket,
      alertsTopic: data.alertsTopic,
    });
    return Template.fromStack(stack);
  };

  it('declares a resolver for Mutation.exportShoppingListImage', () => {
    const template = synth();
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'exportShoppingListImage',
      DataSourceName: Match.anyValue(),
    });
  });

  it('grants exportShoppingListImage s3:PutObject scoped to the exports/* prefix only — never the whole bucket, never any other resolver', () => {
    const template = synth();
    const policies = template.findResources('AWS::IAM::Policy');
    const putStatementsByRole = Object.values(policies).flatMap((policy) => {
      const typed = policy as {
        Properties: {
          PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> };
          Roles?: Array<{ Ref?: string }>;
        };
      };
      const roleRefs = (typed.Properties.Roles ?? []).map((role) => role.Ref).filter((ref): ref is string => ref !== undefined);
      return typed.Properties.PolicyDocument.Statement.filter((statement) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        return actions.includes('s3:PutObject');
      }).map((statement) => ({ statement, roleRefs }));
    });

    const entry = putStatementsByRole.find((e) => e.roleRefs.some((ref) => ref.startsWith('ExportShoppingListImageFnServiceRole')));
    expect(entry).toBeDefined();
    // Never a bare "*" — scoped to a real resource ARN ending in the
    // `exports/*` prefix specifically, not the bucket's own root ARN.
    expect(entry!.statement.Resource).not.toBe('*');
    const resourceJson = JSON.stringify(entry!.statement.Resource);
    expect(resourceJson).toMatch(/exports\/\*/);

    // No other Lambda's role gets this grant.
    const otherRolesWithPut = putStatementsByRole.filter(
      (e) => !e.roleRefs.some((ref) => ref.startsWith('ExportShoppingListImageFnServiceRole')),
    );
    expect(otherRolesWithPut).toHaveLength(0);

    const vpcFunctions = ourFunctions(template).filter(([, r]) => r.Properties.VpcConfig);
    const [, exportFn] = vpcFunctions.find(([logicalId]) => logicalId.startsWith('ExportShoppingListImageFn'))!;
    const env = exportFn.Properties.Environment!.Variables;
    expect(env['EXPORTS_BUCKET_NAME']).toBeDefined();

    const withExportsBucketEnv = vpcFunctions.filter(([, fn]) => fn.Properties.Environment!.Variables['EXPORTS_BUCKET_NAME'] !== undefined);
    expect(withExportsBucketEnv).toHaveLength(1);
  });
});
