import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ApiStack } from '../stacks/api-stack';
import { DataStack } from '../stacks/data-stack';

/**
 * W20 S3 (`E2E_MVP_PLAN.md` §27, D1/D4) — `Mutation.getPantryPhotoUploadUrl`'s
 * infra assertions, in their own file for the same `max-lines` reason
 * `api-stack.exportShoppingListImage.test.ts` was split out, with the same
 * own-throwaway-fixture convention.
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

type Fn = { Properties: { VpcConfig?: unknown; Environment?: { Variables: Record<string, unknown> } } };
const functions = (template: Template): Array<[string, Fn]> =>
  Object.entries(template.findResources('AWS::Lambda::Function')).filter(([id]) => !id.startsWith('LogRetention')) as Array<[string, Fn]>;

describe('ApiStack — Mutation.analyzePantryPhoto (W20 S4)', () => {
  it('declares a resolver for Mutation.analyzePantryPhoto', () => {
    synth().hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'analyzePantryPhoto',
      DataSourceName: Match.anyValue(),
    });
  });

  it('is a non-VPC Lambda with the uploads bucket, cache table and Gemini secret (D1: no DB; it calls the model)', () => {
    const [, fn] = functions(synth()).find(([id]) => id.startsWith('AnalyzePantryPhotoFn'))!;
    const env = fn.Properties.Environment!.Variables;

    expect(fn.Properties.VpcConfig).toBeUndefined();
    expect(env['UPLOADS_BUCKET_NAME']).toBeDefined();
    expect(env['CACHE_TABLE_NAME']).toBeDefined();
    expect(env['GEMINI_API_KEY_SECRET_ARN']).toBeDefined();
    expect(env['EXPORTS_BUCKET_NAME']).toBeUndefined();
  });

  it('may read and delete pantry-photos/* — and nothing more: no Put, no List, no other prefix', () => {
    const policies = Object.values(synth().findResources('AWS::IAM::Policy')) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> }; Roles?: Array<{ Ref?: string }> };
    }>;
    const s3Grants = policies.flatMap((policy) =>
      policy.Properties.PolicyDocument.Statement.flatMap((statement) => {
        const actions = (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).filter((a) => a.startsWith('s3:'));
        const roles = (policy.Properties.Roles ?? []).map((r) => r.Ref ?? '');
        return actions.length > 0 ? [{ actions, resource: JSON.stringify(statement.Resource), roles }] : [];
      }),
    );

    const mine = s3Grants.filter((g) => g.roles.some((r) => r.startsWith('AnalyzePantryPhotoFnServiceRole')));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.flatMap((g) => g.actions).sort()).toEqual(['s3:DeleteObject', 's3:GetObject']);
    for (const grant of mine) expect(grant.resource).toMatch(/pantry-photos\/\*/);

    // The presign Lambda keeps its write-only grant; nobody else touches pantry-photos/*.
    const others = s3Grants.filter(
      (g) => g.resource.includes('pantry-photos') && !g.roles.some((r) => r.startsWith('AnalyzePantryPhotoFnServiceRole') || r.startsWith('GetPantryPhotoUploadUrlFnServiceRole')),
    );
    expect(others).toHaveLength(0);
    const presign = s3Grants.filter((g) => g.roles.some((r) => r.startsWith('GetPantryPhotoUploadUrlFnServiceRole')));
    expect(presign.flatMap((g) => g.actions)).toEqual(['s3:PutObject']);
  });
});
