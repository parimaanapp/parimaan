import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ApiStack } from '../stacks/api-stack';
import { DataStack } from '../stacks/data-stack';

/**
 * W21 S3 (`E2E_MVP_PLAN.md` §28 D2) — `Mutation.cookFromPantry`'s infra
 * assertions, in their own file for the same `max-lines` reason as the other
 * per-feature ApiStack tests, with the same own-throwaway-fixture convention.
 */
const synth = (): Template => {
  const app = new cdk.App();
  const authStack = new cdk.Stack(app, 'Parimaan-dev-FakeAuth');
  const userPool = new UserPool(authStack, 'UserPool', { selfSignUpEnabled: false, signInAliases: { email: true } });
  const vpc = new Vpc(new cdk.Stack(app, 'Parimaan-dev-FakeNetwork'), 'Vpc', {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
      { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      { name: 'private-egress', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
    ],
  });
  const data = new DataStack(app, 'Parimaan-dev-FakeData', { envName: 'dev', vpc });
  const stack = new ApiStack(app, 'Parimaan-dev-Api', {
    envName: 'dev',
    userPool,
    vpc,
    dbCluster: data.dbCluster,
    appRoleSecret: data.appRoleSecret,
    lambdaSecurityGroup: data.lambdaSecurityGroup,
    cacheTable: data.cacheTable,
    exportsBucket: data.exportsBucket,
    uploadsBucket: data.uploadsBucket,
    alertsTopic: data.alertsTopic,
  });
  return Template.fromStack(stack);
};

type Fn = { Properties: { VpcConfig?: { SubnetIds: unknown[] }; Environment?: { Variables: Record<string, unknown> } } };
const functions = (template: Template): Array<[string, Fn]> =>
  Object.entries(template.findResources('AWS::Lambda::Function')).filter(([id]) => !id.startsWith('LogRetention')) as Array<[string, Fn]>;

const cook = (template: Template): [string, Fn] => functions(template).find(([id]) => id.startsWith('CookFromPantryFn'))!;

describe('ApiStack — Mutation.cookFromPantry (W21 S3)', () => {
  it('declares a resolver for Mutation.cookFromPantry', () => {
    synth().hasResourceProperties('AWS::AppSync::Resolver', { TypeName: 'Mutation', FieldName: 'cookFromPantry', DataSourceName: Match.anyValue() });
  });

  it('is a VPC Lambda (it reads Aurora under RLS) in the egress-capable subnets (it calls Gemini)', () => {
    const template = synth();
    const [, fn] = cook(template);
    expect(fn.Properties.VpcConfig).toBeDefined();
    // Placed in the private-egress group, not the isolated one: no isolated subnet has a route to the internet.
    const staples = functions(template).find(([id]) => id.startsWith('StaplesNoteFn'))![1];
    expect(fn.Properties.VpcConfig?.SubnetIds).toEqual(staples.Properties.VpcConfig?.SubnetIds);
    const cookSubnets = JSON.stringify(fn.Properties.VpcConfig?.SubnetIds);
    const isolated = functions(template).find(([id]) => id.startsWith('PantryFn'))![1];
    expect(cookSubnets).not.toBe(JSON.stringify(isolated.Properties.VpcConfig?.SubnetIds));
  });

  it('gets the cache table name and the Gemini secret ARN, and connects as the least-privileged app role, never the cluster admin', () => {
    const env = cook(synth())[1].Properties.Environment!.Variables;
    expect(env['CACHE_TABLE_NAME']).toBeDefined();
    expect(env['GEMINI_API_KEY_SECRET_ARN']).toBeDefined();
    expect(env['APP_ROLE_SECRET_ARN']).toBeDefined();
    expect(env['DB_SECRET_ARN']).toBeUndefined();
  });

  it('is granted exactly GetItem, PutItem and UpdateItem on the cache table, and nothing broader', () => {
    const template = synth();
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap((policy) => {
      const typed = policy as { Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> }; Roles?: Array<{ Ref?: string }> } };
      const onCook = (typed.Properties.Roles ?? []).some((role) => role.Ref?.startsWith('CookFromPantryFn') === true);
      return onCook ? typed.Properties.PolicyDocument.Statement : [];
    });
    const dynamo = statements.filter((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]).some((a) => a.startsWith('dynamodb:')));
    expect(dynamo).toHaveLength(1);
    const actions = Array.isArray(dynamo[0]!.Action) ? dynamo[0]!.Action : [dynamo[0]!.Action];
    expect([...actions].sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']);
    expect(dynamo[0]!.Resource).not.toBe('*');
  });

  it('may read only the one Gemini secret', () => {
    const template = synth();
    const secretStatements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap((policy) => {
      const typed = policy as { Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> }; Roles?: Array<{ Ref?: string }> } };
      const onCook = (typed.Properties.Roles ?? []).some((role) => role.Ref?.startsWith('CookFromPantryFn') === true);
      return onCook ? typed.Properties.PolicyDocument.Statement.filter((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]).some((a) => a.startsWith('secretsmanager:'))) : [];
    });
    const geminiGrants = secretStatements.filter((s) => JSON.stringify(s.Resource).includes('parimaan/gemini-api-key'));
    expect(geminiGrants).toHaveLength(1);
    expect(JSON.stringify(geminiGrants[0]!.Resource)).not.toContain('"*"');
  });

  it('gives no other database resolver the Gemini secret — only cookFromPantry and staplesNoteFn have it among the VPC Lambdas', () => {
    const withGemini = functions(synth())
      .filter(([, fn]) => fn.Properties.VpcConfig !== undefined && fn.Properties.Environment?.Variables['GEMINI_API_KEY_SECRET_ARN'] !== undefined)
      .map(([id]) => id)
      .sort();
    expect(withGemini).toHaveLength(2);
    expect(withGemini[0]).toMatch(/^CookFromPantryFn/);
    expect(withGemini[1]).toMatch(/^StaplesNoteFn/);
  });
});
