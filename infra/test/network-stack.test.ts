import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { NetworkStack } from '../stacks/network-stack';

describe('NetworkStack', () => {
  const build = (envName: 'dev' | 'prod'): NetworkStack => {
    const app = new cdk.App();
    return new NetworkStack(app, `Parimaan-${envName}-Network`, { envName });
  };

  const synth = (envName: 'dev' | 'prod'): Template => Template.fromStack(build(envName));

  it('synthesizes without error for dev', () => {
    expect(() => synth('dev')).not.toThrow();
  });

  it('synthesizes without error for prod', () => {
    expect(() => synth('prod')).not.toThrow();
  });

  it('creates a VPC with exactly 2 AZs worth of subnets (6 total: 2 public + 2 isolated + 2 private-egress)', () => {
    // W17 S1 (E2E_MVP_PLAN.md §23.2.1 D1) — a third subnet group,
    // `private-egress`, is added alongside (not instead of) `isolated`.
    const template = synth('dev');
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });

  it('has exactly one NAT Gateway (W17 S1, §23.2.1 D1 — single-AZ, founder-approved cost given active AWS Activate credits)', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('has exactly 2 public subnets (one per AZ)', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::EC2::Subnet', {
      MapPublicIpOnLaunch: true,
    });
    const publicSubnets = template.findResources('AWS::EC2::Subnet', {
      Properties: { MapPublicIpOnLaunch: true },
    });
    expect(Object.keys(publicSubnets)).toHaveLength(2);
  });

  it('has exactly 2 isolated (private, no-NAT) subnets (one per AZ) — unaffected by the new NAT Gateway/egress group', () => {
    const template = synth('dev');
    // Both private subnet groups (`isolated` and the new `private-egress`)
    // report `MapPublicIpOnLaunch: false`, so isolate on the CDK-assigned
    // subnet name (`aws-cdk:subnet-name` tag) to tell them apart — the
    // route-table assertions below are what actually prove `isolated` has
    // no internet route, which is the property that matters.
    const isolatedSubnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        MapPublicIpOnLaunch: false,
        Tags: Match.arrayWith([Match.objectLike({ Key: 'aws-cdk:subnet-name', Value: 'isolated' })]),
      },
    });
    expect(Object.keys(isolatedSubnets)).toHaveLength(2);
  });

  it('has exactly 2 new private-egress subnets (one per AZ), alongside (not replacing) the isolated group', () => {
    const template = synth('dev');
    const egressSubnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        MapPublicIpOnLaunch: false,
        Tags: Match.arrayWith([Match.objectLike({ Key: 'aws-cdk:subnet-name', Value: 'private-egress' })]),
      },
    });
    expect(Object.keys(egressSubnets)).toHaveLength(2);
  });

  it('routes the private-egress subnets\' route tables to the NAT Gateway (real internet egress)', () => {
    const template = synth('dev');
    const egressRoutes = template.findResources('AWS::EC2::Route', {
      Properties: {
        DestinationCidrBlock: '0.0.0.0/0',
        NatGatewayId: Match.anyValue(),
      },
    });
    // One default route per private-egress subnet (one per AZ).
    expect(Object.keys(egressRoutes)).toHaveLength(2);
  });

  it('gives the isolated subnets\' route tables no default (0.0.0.0/0) route at all — zero internet route, unchanged', () => {
    const template = synth('dev');
    // Every 0.0.0.0/0 route in the template must be the private-egress
    // group's NAT-Gateway route asserted above — none may lack a
    // NatGatewayId (which would mean an isolated subnet gained an
    // internet route) and none may point at an Internet Gateway (which
    // only the public subnets' own route tables may do).
    const defaultRoutes = template.findResources('AWS::EC2::Route', {
      Properties: { DestinationCidrBlock: '0.0.0.0/0' },
    });
    const nonNatDefaultRoutes = Object.values(defaultRoutes).filter(
      (route) => (route as { Properties: Record<string, unknown> }).Properties['NatGatewayId'] === undefined,
    );
    // The public subnets' own 0.0.0.0/0 -> Internet Gateway routes are the
    // only non-NAT default routes expected; one per AZ.
    expect(nonNatDefaultRoutes).toHaveLength(2);
    for (const route of nonNatDefaultRoutes) {
      const properties = (route as { Properties: Record<string, unknown> }).Properties;
      expect(properties['GatewayId']).toBeDefined();
    }
  });

  it('creates an S3 gateway VPC endpoint', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.objectLike({
        'Fn::Join': Match.arrayWith([
          Match.arrayWith([Match.stringLikeRegexp('s3$')]),
        ]),
      }),
      VpcEndpointType: 'Gateway',
    });
  });

  it('creates a DynamoDB gateway VPC endpoint', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.objectLike({
        'Fn::Join': Match.arrayWith([
          Match.arrayWith([Match.stringLikeRegexp('dynamodb$')]),
        ]),
      }),
      VpcEndpointType: 'Gateway',
    });
  });

  it('creates a Bedrock interface VPC endpoint', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.objectLike({
        'Fn::Join': Match.arrayWith([
          Match.arrayWith([Match.stringLikeRegexp('bedrock-runtime$')]),
        ]),
      }),
      VpcEndpointType: 'Interface',
    });
  });

  it('creates a Secrets Manager interface VPC endpoint', () => {
    const template = synth('dev');
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.objectLike({
        'Fn::Join': Match.arrayWith([
          Match.arrayWith([Match.stringLikeRegexp('secretsmanager$')]),
        ]),
      }),
      VpcEndpointType: 'Interface',
    });
  });

  it('declares exactly 4 VPC endpoints in total', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::EC2::VPCEndpoint', 4);
  });

  it('does not embed an account id or region literal in the synthesized template', () => {
    // See the identical comment in data-stack.test.ts: a bare `/\d{12}/`
    // can false-positive on a random 12-digit run inside a bundled
    // Lambda's long content-hash S3 asset key. Requiring the digits to be
    // quote-bounded catches a real embedded account id without that risk.
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/"\d{12}"/);
    expect(json).not.toMatch(/ap-south-1/);
  });

  it('exposes the VPC as a public readonly property for downstream stacks', () => {
    const stack = build('dev');
    expect(stack.vpc).toBeDefined();
    expect(stack.vpc).toBeInstanceOf(Vpc);
  });

  // Change-detector per DEV_WORKFLOW.md §3.4(c): fine-grained assertions above
  // are primary; this snapshot exists only to flag *any* unreviewed diff in
  // the synthesized template, not to encode intent on its own.
  it('matches the known-good synthesized template snapshot (dev)', () => {
    expect(synth('dev').toJSON()).toMatchSnapshot();
  });
});
