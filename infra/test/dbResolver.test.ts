import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import type { IVpc } from 'aws-cdk-lib/aws-ec2';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { createDbResolverFunction, resolveDbResolverVpcSubnets } from '../stacks/dbResolver';

// `resolvers/health.ts` stands in purely as a real, already-existing,
// trivially-bundlable entry file — the same choice `nonVpcResolver.test.ts`
// makes for the identical reason. Nothing about health.ts's own behavior is
// under test here, only the construct shape `createDbResolverFunction`
// produces around it.
const HEALTH_RESOLVER_ENTRY_NAME = 'health.ts';

describe('resolveDbResolverVpcSubnets', () => {
  it('defaults to the isolated subnet type when needsInternetEgress is false — every pre-W17 resolver\'s placement, unchanged', () => {
    expect(resolveDbResolverVpcSubnets(false)).toEqual({ subnetType: SubnetType.PRIVATE_ISOLATED });
  });

  it('selects the new private-egress subnet type when needsInternetEgress is true', () => {
    expect(resolveDbResolverVpcSubnets(true)).toEqual({ subnetType: SubnetType.PRIVATE_WITH_EGRESS });
  });
});

describe('createDbResolverFunction', () => {
  // Mirrors `network-stack.ts`'s real `subnetConfiguration` exactly (W17
  // S1, both private subnet groups) — the same "kept in sync deliberately"
  // precedent `api-stack.test.ts`'s own `buildFakeVpc` fixture already
  // follows against a *previous* version of that same config. Both groups
  // must exist here for this test to exercise a real choice between them.
  const buildFakeVpc = (stack: cdk.Stack): Vpc =>
    new Vpc(stack, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'private-egress', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

  /** Every synthesized `AWS::EC2::Subnet` logical id tagged with the given `aws-cdk:subnet-name` value. */
  const subnetLogicalIdsByGroup = (template: Template, groupName: string): string[] =>
    Object.keys(
      template.findResources('AWS::EC2::Subnet', {
        Properties: {
          Tags: Match.arrayWith([Match.objectLike({ Key: 'aws-cdk:subnet-name', Value: groupName })]),
        },
      }),
    );

  /** The sole Lambda function's `VpcConfig.SubnetIds`, as the `Ref` logical ids CloudFormation resolves at deploy time. */
  const subnetRefsOfTheOnlyFunction = (template: Template): string[] => {
    const entries = Object.entries(template.findResources('AWS::Lambda::Function')) as Array<
      [string, { Properties: { VpcConfig: { SubnetIds: Array<{ Ref: string }> } } }]
    >;
    const fn = entries[0]![1];
    return fn.Properties.VpcConfig.SubnetIds.map((subnetId: { Ref: string }) => subnetId.Ref);
  };

  const build = (needsInternetEgress: boolean): Template => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'FakeDbResolverStack');
    // Same `exactOptionalPropertyTypes` structural-mismatch cast
    // `api-stack.ts`'s own constructor already documents — `Vpc` implements
    // every member `IVpc` needs at runtime.
    const vpc = buildFakeVpc(stack) as IVpc;
    const appRoleSecret = new Secret(stack, 'AppRoleSecret');
    const lambdaSecurityGroup = new SecurityGroup(stack, 'LambdaSg', { vpc });
    // Only `.clusterEndpoint.hostname`/`.port` are ever read by
    // `createDbResolverFunction` (two environment-variable strings) — a
    // plain fake avoids synthesizing a real (slow) Aurora cluster construct
    // just to read them off it.
    const dbCluster = {
      clusterEndpoint: { hostname: 'fake-db-host', port: 5432 },
    } as unknown as DatabaseCluster;

    createDbResolverFunction(
      stack,
      'TestFn',
      HEALTH_RESOLVER_ENTRY_NAME,
      { vpc, dbCluster, appRoleSecret, lambdaSecurityGroup },
      false,
      needsInternetEgress,
    );

    return Template.fromStack(stack);
  };

  it('synthesizes without error for both the default and egress-opted-in placement', () => {
    expect(() => build(false)).not.toThrow();
    expect(() => build(true)).not.toThrow();
  });

  it('places the Lambda in the isolated subnets by default (needsInternetEgress unset) — every pre-W17 resolver\'s placement, unaffected', () => {
    const template = build(false);
    const isolatedIds = subnetLogicalIdsByGroup(template, 'isolated');
    const egressIds = subnetLogicalIdsByGroup(template, 'private-egress');
    expect(isolatedIds).toHaveLength(2);
    const fnSubnetIds = subnetRefsOfTheOnlyFunction(template);
    expect([...fnSubnetIds].sort()).toEqual([...isolatedIds].sort());
    for (const id of fnSubnetIds) {
      expect(egressIds).not.toContain(id);
    }
  });

  it('places the Lambda in the new private-egress subnets when needsInternetEgress is true, never the isolated ones', () => {
    const template = build(true);
    const isolatedIds = subnetLogicalIdsByGroup(template, 'isolated');
    const egressIds = subnetLogicalIdsByGroup(template, 'private-egress');
    expect(egressIds).toHaveLength(2);
    const fnSubnetIds = subnetRefsOfTheOnlyFunction(template);
    expect([...fnSubnetIds].sort()).toEqual([...egressIds].sort());
    for (const id of fnSubnetIds) {
      expect(isolatedIds).not.toContain(id);
    }
  });

  it('runs on the Node 24 runtime with the shared handler export, regardless of subnet placement', () => {
    for (const needsInternetEgress of [false, true]) {
      const template = build(needsInternetEgress);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs24.x',
        Handler: 'index.handler',
      });
    }
  });

  it('declares exactly one Lambda function per build — no incidental extra resources from the flag itself', () => {
    for (const needsInternetEgress of [false, true]) {
      const template = build(needsInternetEgress);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    }
  });
});
