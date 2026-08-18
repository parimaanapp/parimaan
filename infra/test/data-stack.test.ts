import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { DatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { DataStack } from '../stacks/data-stack';

/**
 * Minimal stand-in for `NetworkStack`'s VPC — same public/isolated subnet
 * shape (see network-stack.ts), built directly in the test so `DataStack`
 * can be exercised in isolation without spinning up the real `NetworkStack`.
 * Deliberately created in its own `cdk.Stack` (not the `App` root, which
 * cannot host constructs directly) so the cross-stack reference pattern
 * matches production: `NetworkStack` owns the VPC, `DataStack` consumes it.
 */
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

describe('DataStack', () => {
  const build = (envName: 'dev' | 'prod'): DataStack => {
    const app = new cdk.App();
    const vpc = buildFakeVpc(app, envName);
    return new DataStack(app, `Parimaan-${envName}-Data`, { envName, vpc });
  };

  const synth = (envName: 'dev' | 'prod'): Template => Template.fromStack(build(envName));

  it('synthesizes without error for dev', () => {
    expect(() => synth('dev')).not.toThrow();
  });

  it('synthesizes without error for prod', () => {
    expect(() => synth('prod')).not.toThrow();
  });

  describe('Aurora Serverless v2 Postgres cluster', () => {
    it('declares exactly one Postgres cluster, storage-encrypted, with a 7-day backup retention', () => {
      const template = synth('dev');
      template.resourceCountIs('AWS::RDS::DBCluster', 1);
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        Engine: 'aurora-postgresql',
        StorageEncrypted: true,
        BackupRetentionPeriod: 7,
      });
    });

    it('deploys into the VPC isolated subnets, not the public ones', () => {
      // Verified empirically: CDK names the cross-stack `Fn::ImportValue` after
      // the originating subnet construct id, which inherits the
      // `subnetConfiguration` name ("isolated" / "public") — so the export
      // name string itself reveals which subnet type was actually selected.
      const template = synth('dev');
      const subnetGroups = template.findResources('AWS::RDS::DBSubnetGroup');
      const groups = Object.values(subnetGroups) as Array<{
        Properties: { SubnetIds: Array<{ 'Fn::ImportValue': string }> };
      }>;
      expect(groups).toHaveLength(1);
      const [group] = groups;
      if (!group) throw new Error('expected exactly one DBSubnetGroup');
      const importNames = group.Properties.SubnetIds.map((ref) => ref['Fn::ImportValue']);
      expect(importNames).toHaveLength(2);
      for (const name of importNames) {
        expect(name).toMatch(/isolatedSubnet/);
        expect(name).not.toMatch(/publicSubnet/);
      }
    });

    it('sets Aurora Serverless v2 min/max capacity to 0.5/2 ACU', () => {
      const template = synth('dev');
      template.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: Match.objectLike({
          MinCapacity: 0.5,
          MaxCapacity: 2,
        }),
      });
    });

    it('enables Aurora Serverless v2 auto-pause via SecondsUntilAutoPause', () => {
      // Verified empirically against the installed aws-cdk-lib (2.265.0):
      // the L2 `DatabaseClusterProps.serverlessV2AutoPauseDuration` prop is
      // what's exposed (not, e.g., a boolean `autoPause` flag), and it maps
      // 1:1 to `ServerlessV2ScalingConfiguration.SecondsUntilAutoPause` in
      // the synthesized `AWS::RDS::DBCluster`. CDK omits this key entirely
      // if the prop isn't passed, so its mere presence proves the prop was
      // set (as opposed to the implicit AWS-side 300s default some engine
      // versions apply even when unset) — hence asserting `toBeDefined()`
      // plus the documented valid range (300s-86400s), not a hardcoded value
      // the implementation is free to choose within that range.
      const template = synth('dev');
      const clusters = template.findResources('AWS::RDS::DBCluster');
      const [cluster] = Object.values(clusters) as Array<{
        Properties: {
          ServerlessV2ScalingConfiguration?: { SecondsUntilAutoPause?: number };
        };
      }>;
      if (!cluster) throw new Error('expected exactly one DBCluster');
      const seconds = cluster.Properties.ServerlessV2ScalingConfiguration?.SecondsUntilAutoPause;
      expect(seconds).toBeDefined();
      expect(seconds).toBeGreaterThanOrEqual(300);
      expect(seconds).toBeLessThanOrEqual(86400);
    });

    it('has zero RDS Proxy resources — direct connections only (E2E_MVP_PLAN.md §10 Q1 locked decision)', () => {
      const template = synth('dev');
      template.resourceCountIs('AWS::RDS::DBProxy', 0);
    });

    it('sources DB credentials via a Secrets-Manager-generated secret, never a literal password', () => {
      const template = synth('dev');
      template.resourceCountIs('AWS::SecretsManager::Secret', 1);
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        GenerateSecretString: Match.objectLike({
          GenerateStringKey: 'password',
        }),
      });
      const json = JSON.stringify(template.toJSON());
      expect(json).toContain('{{resolve:secretsmanager:');
      // The cluster's MasterUserPassword must only ever appear as the dynamic
      // reference above — never as a literal string value.
      expect(json).not.toMatch(/"MasterUserPassword"\s*:\s*"(?!\{\{resolve:)[^"]+"/);
    });

    it('the DB security group has zero ingress rules (api-stack adds specific ingress later)', () => {
      const template = synth('dev');
      const clusters = template.findResources('AWS::RDS::DBCluster');
      const [cluster] = Object.values(clusters) as Array<{
        Properties: { VpcSecurityGroupIds: Array<{ 'Fn::GetAtt': [string, string] }> };
      }>;
      if (!cluster) throw new Error('expected exactly one DBCluster');
      const sgLogicalIds = cluster.Properties.VpcSecurityGroupIds.map(
        (ref) => ref['Fn::GetAtt'][0],
      );
      expect(sgLogicalIds.length).toBeGreaterThan(0);
      const allSgs = template.findResources('AWS::EC2::SecurityGroup');
      for (const logicalId of sgLogicalIds) {
        const sg = allSgs[logicalId] as {
          Properties?: { SecurityGroupIngress?: unknown[] };
        };
        expect(sg).toBeDefined();
        expect(sg.Properties?.SecurityGroupIngress ?? []).toHaveLength(0);
      }
    });
  });

  describe('S3 buckets', () => {
    it('declares exactly 2 buckets, named parimaan-uploads-dev / parimaan-exports-dev for dev', () => {
      const template = synth('dev');
      template.resourceCountIs('AWS::S3::Bucket', 2);
      template.hasResourceProperties('AWS::S3::Bucket', { BucketName: 'parimaan-uploads-dev' });
      template.hasResourceProperties('AWS::S3::Bucket', { BucketName: 'parimaan-exports-dev' });
    });

    it('declares exactly 2 buckets, named parimaan-uploads-prod / parimaan-exports-prod for prod', () => {
      const template = synth('prod');
      template.resourceCountIs('AWS::S3::Bucket', 2);
      template.hasResourceProperties('AWS::S3::Bucket', { BucketName: 'parimaan-uploads-prod' });
      template.hasResourceProperties('AWS::S3::Bucket', { BucketName: 'parimaan-exports-prod' });
    });

    it('blocks all public access and enables SSE-S3 (AES256) encryption on both buckets', () => {
      const template = synth('dev');
      const buckets = template.findResources('AWS::S3::Bucket');
      const resources = Object.values(buckets) as Array<{
        Properties: {
          PublicAccessBlockConfiguration?: {
            BlockPublicAcls: boolean;
            BlockPublicPolicy: boolean;
            IgnorePublicAcls: boolean;
            RestrictPublicBuckets: boolean;
          };
          BucketEncryption?: {
            ServerSideEncryptionConfiguration: Array<{
              ServerSideEncryptionByDefault: { SSEAlgorithm: string };
            }>;
          };
        };
      }>;
      expect(resources).toHaveLength(2);
      for (const bucket of resources) {
        expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
        expect(
          bucket.Properties.BucketEncryption?.ServerSideEncryptionConfiguration[0]
            ?.ServerSideEncryptionByDefault.SSEAlgorithm,
        ).toBe('AES256');
      }
    });

    it('only the exports bucket has a lifecycle rule, expiring objects after 30 days', () => {
      const template = synth('dev');
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'parimaan-exports-dev',
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({ ExpirationInDays: 30, Status: 'Enabled' }),
          ]),
        },
      });
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'parimaan-uploads-dev',
        LifecycleConfiguration: Match.absent(),
      });
    });

    it('dev buckets use DESTROY removal policy (SD §12.1: dev is disposable, iterative)', () => {
      const template = synth('dev');
      const buckets = Object.values(template.findResources('AWS::S3::Bucket')) as Array<{
        DeletionPolicy: string;
      }>;
      expect(buckets).toHaveLength(2);
      for (const bucket of buckets) {
        expect(bucket.DeletionPolicy).toBe('Delete');
      }
    });

    it('prod buckets use RETAIN removal policy (real uploaded/exported data, not disposable)', () => {
      const template = synth('prod');
      const buckets = Object.values(template.findResources('AWS::S3::Bucket')) as Array<{
        DeletionPolicy: string;
      }>;
      expect(buckets).toHaveLength(2);
      for (const bucket of buckets) {
        expect(bucket.DeletionPolicy).toBe('Retain');
      }
    });
  });

  describe('DynamoDB cache table', () => {
    it('creates parimaan-cache-dev with PK/SK string keys, ttl attribute, and on-demand billing', () => {
      const template = synth('dev');
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'parimaan-cache-dev',
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: Match.arrayWith([
          Match.objectLike({ AttributeName: 'PK', AttributeType: 'S' }),
          Match.objectLike({ AttributeName: 'SK', AttributeType: 'S' }),
        ]),
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: 'PK', KeyType: 'HASH' }),
          Match.objectLike({ AttributeName: 'SK', KeyType: 'RANGE' }),
        ]),
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      });
    });

    it('creates parimaan-cache-prod for a prod synth', () => {
      const template = synth('prod');
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'parimaan-cache-prod',
      });
    });

    it('is encrypted at rest via the default AWS-owned key — no customer-managed SSESpecification', () => {
      // Verified empirically: a `dynamodb.Table` with no `encryption` prop
      // (or `TableEncryption.DEFAULT`) omits `SSESpecification` entirely from
      // the synthesized resource. DynamoDB tables are always encrypted at
      // rest regardless — the *absence* of this key is what "AWS-owned key,
      // no customer KMS key" looks like on the wire, not its presence.
      const template = synth('dev');
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'parimaan-cache-dev',
        SSESpecification: Match.absent(),
      });
    });

    it('the cache table always uses DESTROY removal policy — it holds only TTL-expiring cache/rate-limit data, never worth retaining in any env', () => {
      const template = synth('dev');
      const [table] = Object.values(template.findResources('AWS::DynamoDB::Table')) as Array<{
        DeletionPolicy: string;
      }>;
      if (!table) throw new Error('expected exactly one DynamoDB table');
      expect(table.DeletionPolicy).toBe('Delete');
    });
  });

  it('creates no customer-managed KMS keys anywhere in the stack (AWS-managed/AWS-owned defaults only, per the documented interpretation)', () => {
    const template = synth('dev');
    template.resourceCountIs('AWS::KMS::Key', 0);
  });

  it('does not embed an account id or hardcoded ap-south-1 region literal in the synthesized template', () => {
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/\d{12}/);
    expect(json).not.toMatch(/ap-south-1/);
  });

  it('exposes dbCluster, uploadsBucket, exportsBucket, and cacheTable as public readonly properties', () => {
    const stack = build('dev');
    expect(stack.dbCluster).toBeDefined();
    expect(stack.dbCluster).toBeInstanceOf(DatabaseCluster);
    expect(stack.uploadsBucket).toBeDefined();
    expect(stack.uploadsBucket).toBeInstanceOf(Bucket);
    expect(stack.exportsBucket).toBeDefined();
    expect(stack.exportsBucket).toBeInstanceOf(Bucket);
    expect(stack.cacheTable).toBeDefined();
    expect(stack.cacheTable).toBeInstanceOf(Table);
  });

  // Change-detector per DEV_WORKFLOW.md §3.4(c): fine-grained assertions above
  // are primary; this snapshot exists only to flag *any* unreviewed diff in
  // the synthesized template, not to encode intent on its own.
  it('matches the known-good synthesized template snapshot (dev)', () => {
    expect(synth('dev').toJSON()).toMatchSnapshot();
  });
});
