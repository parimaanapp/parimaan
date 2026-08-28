import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { createNonVpcResolverFunction } from '../stacks/nonVpcResolver';

// `resolvers/health.ts` stands in purely as a real, already-existing,
// trivially-bundlable entry file — no AI_RESOLVERS/NET_RESOLVERS production
// entry exists yet as of W7 S2 (S3/S5 add the first ones), so there is
// nothing else to point a real NodejsFunction bundle at. This file is
// chosen deliberately for having no household/DB/AI logic of its own, so
// nothing about its own behaviour is under test here — only the construct
// shape `createNonVpcResolverFunction` produces around it.
const HEALTH_RESOLVER_ENTRY = join(__dirname, '../../api/src/resolvers/health.ts');

describe('createNonVpcResolverFunction', () => {
  const synth = (environment?: Record<string, string>): Template => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'FakeNonVpcResolverStack');
    createNonVpcResolverFunction(stack, 'TestFn', { entry: HEALTH_RESOLVER_ENTRY, ...(environment ? { environment } : {}) });
    return Template.fromStack(stack);
  };

  it('synthesizes without error', () => {
    expect(() => synth()).not.toThrow();
  });

  it('has no VpcConfig at all — no VPC, no subnets, no security group', () => {
    const template = synth();
    const [, fn] = Object.entries(template.findResources('AWS::Lambda::Function'))[0] as [
      string,
      { Properties: Record<string, unknown> },
    ];
    expect(fn.Properties.VpcConfig).toBeUndefined();
  });

  it('runs on the Node 24 runtime with the shared handler export', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Handler: 'index.handler',
    });
  });

  it('sets a 28s timeout — under AppSync\'s 30s resolver ceiling with a little headroom', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', { Timeout: 28 });
  });

  it('passes through the given environment variables and nothing else host-provided', () => {
    const template = synth({ GEMINI_API_KEY_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/gemini-api-key-abc' });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectEquals({
          GEMINI_API_KEY_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/gemini-api-key-abc',
        }),
      },
    });
  });

  it('has no environment variables at all when none are passed', () => {
    const template = synth();
    const [, fn] = Object.entries(template.findResources('AWS::Lambda::Function'))[0] as [
      string,
      { Properties: { Environment?: { Variables?: Record<string, unknown> } } },
    ];
    expect(fn.Properties.Environment?.Variables ?? {}).toEqual({});
  });

  it('declares exactly one Lambda function — no incidental extra resources', () => {
    const template = synth();
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });
});
