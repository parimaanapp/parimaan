import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ApiStack } from '../stacks/api-stack';
import { DataStack } from '../stacks/data-stack';

/**
 * B2a — infra assertions for the ingredient catalog queries, split out of
 * `api-stack.test.ts` to keep that file under the `max-lines` ceiling. Own
 * throwaway fixtures, same convention as the other `api-stack.*.test.ts`.
 */
const synth = (): Template => {
  const app = new cdk.App();
  const authStack = new cdk.Stack(app, 'Parimaan-dev-FakeAuth');
  const userPool = new UserPool(authStack, 'UserPool', {
    selfSignUpEnabled: false,
    signInAliases: { email: true },
  });
  const vpcStack = new cdk.Stack(app, 'Parimaan-dev-FakeNetwork');
  const vpc = new Vpc(vpcStack, 'Vpc', {
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

describe('ApiStack — ingredient catalog (B2a)', () => {
  it('declares resolvers for Query.ingredientCatalog and Query.searchIngredients', () => {
    const template = synth();
    for (const fieldName of ['ingredientCatalog', 'searchIngredients']) {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: 'Query',
        FieldName: fieldName,
        DataSourceName: Match.anyValue(),
      });
    }
  });

  it('backs both queries with VPC-attached Lambdas that have no cache-table, secret or bucket grants', () => {
    const template = synth();
    const functions = Object.entries(template.findResources('AWS::Lambda::Function')).filter(
      ([id]) => id.startsWith('IngredientCatalogFn') || id.startsWith('SearchIngredientsFn'),
    ) as Array<[string, { Properties: { VpcConfig?: unknown; Environment: { Variables: Record<string, unknown> } } }]>;
    expect(functions).toHaveLength(2);
    for (const [, fn] of functions) {
      expect(fn.Properties.VpcConfig).toBeDefined();
      const env = fn.Properties.Environment.Variables;
      expect(env['CACHE_TABLE_NAME']).toBeUndefined();
      expect(env['EXPORTS_BUCKET_NAME']).toBeUndefined();
      expect(env['GEMINI_API_KEY_SECRET_ARN']).toBeUndefined();
    }
  });

  it('resolves CatalogIngredient.aliases(limit) on a NONE data source, so no Lambda runs per item', () => {
    const template = synth();
    const resolvers = Object.values(template.findResources('AWS::AppSync::Resolver')) as Array<{
      Properties: { TypeName: string; FieldName: string; ResponseMappingTemplate?: string };
    }>;
    const aliases = resolvers.find(
      (r) => r.Properties.TypeName === 'CatalogIngredient' && r.Properties.FieldName === 'aliases',
    );
    expect(aliases).toBeDefined();
    expect(aliases?.Properties.ResponseMappingTemplate).toContain('subList');
    expect(aliases?.Properties.ResponseMappingTemplate).toContain('$ctx.args.limit');

    const dataSources = Object.values(template.findResources('AWS::AppSync::DataSource')) as Array<{
      Properties: { Type: string; Name: string };
    }>;
    const none = dataSources.filter((d) => d.Properties.Type === 'NONE');
    expect(none).toHaveLength(1);
    expect(none[0]?.Properties.Name).toBe('CatalogIngredientAliasesDataSource');
  });
});
