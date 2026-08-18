import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GraphqlApi } from 'aws-cdk-lib/aws-appsync';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { ApiStack } from '../stacks/api-stack';

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

// SINGLE SOURCE OF TRUTH per shared/schema.graphql's own header — the
// synthesized AppSync schema definition must be sourced from this exact
// file, not an inline placeholder string that could silently drift from it.
const REAL_SCHEMA_PATH = join(__dirname, '../../shared/schema.graphql');
const REAL_SCHEMA_CONTENTS = readFileSync(REAL_SCHEMA_PATH, 'utf-8');

describe('ApiStack', () => {
  const build = (envName: 'dev' | 'prod'): ApiStack => {
    const app = new cdk.App();
    const userPool = buildFakeUserPool(app, envName);
    return new ApiStack(app, `Parimaan-${envName}-Api`, { envName, userPool });
  };

  const synth = (envName: 'dev' | 'prod'): Template => Template.fromStack(build(envName));

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
    const stack = new ApiStack(app, 'Parimaan-dev-Api', { envName: 'dev', userPool });
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

  it('declares our health Lambda function, on the Node.js 20 runtime', () => {
    // Verified empirically: the stack's `logConfig` on the AppSync API (for
    // observability — see SYSTEM_DESIGN.md §11.3) makes CDK auto-create a
    // second, internal "LogRetention" custom-resource Lambda (nodejs24.x, a
    // CDK-owned helper, not something this stack declares) to manage the log
    // group's retention period. A blanket "exactly 1 Lambda in the stack"
    // count is the wrong assertion; scope to our own function specifically.
    const template = synth('dev');
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
    });
  });

  it('declares exactly one AppSync Lambda data source, wired to the Lambda function', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::AppSync::DataSource', 1);
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'AWS_LAMBDA',
      LambdaConfig: Match.objectLike({
        LambdaFunctionArn: Match.anyValue(),
      }),
    });
  });

  it('declares exactly one resolver, for Query._health, using the Lambda data source', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::AppSync::Resolver', 1);
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: '_health',
      DataSourceName: Match.anyValue(),
    });
  });

  it('enables X-Ray tracing on the AppSync API', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      XrayEnabled: true,
    });
  });

  it('does not embed an account id or hardcoded ap-south-1 region literal in the synthesized template', () => {
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/\d{12}/);
    expect(json).not.toMatch(/ap-south-1/);
  });

  it('exposes api as a public readonly GraphqlApi property for downstream stacks/testing to reference', () => {
    const stack = build('dev');
    expect(stack.api).toBeDefined();
    expect(stack.api).toBeInstanceOf(GraphqlApi);
  });

  // Change-detector per DEV_WORKFLOW.md §3.4(c): fine-grained assertions above
  // are primary; this snapshot exists only to flag *any* unreviewed diff in
  // the synthesized template, not to encode intent on its own.
  it('matches the known-good synthesized template snapshot (dev)', () => {
    expect(synth('dev').toJSON()).toMatchSnapshot();
  });
});
