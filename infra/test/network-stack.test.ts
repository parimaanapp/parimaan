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

  it('creates a VPC with exactly 2 AZs worth of subnets (4 total: 2 public + 2 isolated)', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  it('has zero NAT Gateways (cost discipline — VPC endpoints used instead)', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
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

  it('has exactly 2 isolated (private, no-NAT) subnets (one per AZ)', () => {
    const template = synth('dev');
    const isolatedSubnets = template.findResources('AWS::EC2::Subnet', {
      Properties: { MapPublicIpOnLaunch: false },
    });
    expect(Object.keys(isolatedSubnets)).toHaveLength(2);
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
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/\d{12}/);
    expect(json).not.toMatch(/ap-south-1/);
  });

  it('exposes the VPC as a public readonly property for downstream stacks', () => {
    const stack = build('dev');
    expect(stack.vpc).toBeDefined();
    expect(stack.vpc).toBeInstanceOf(Vpc);
  });
});
