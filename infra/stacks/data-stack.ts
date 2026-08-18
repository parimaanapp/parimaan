import * as cdk from 'aws-cdk-lib';
import type { IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import {
  AttributeType,
  BillingMode,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
} from 'aws-cdk-lib/aws-rds';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
  /**
   * VPC from NetworkStack — DataStack does not create its own.
   * Typed as the concrete `Vpc` class (matching `NetworkStack.vpc`'s type),
   * not the `IVpc` interface — `Vpc` assigned to an `IVpc`-typed parameter
   * fails under `exactOptionalPropertyTypes` due to a structural mismatch
   * in aws-cdk-lib's own type declarations, unrelated to any real bug here.
   */
  readonly vpc: Vpc;
}

/**
 * Aurora Serverless v2 Postgres, S3 uploads/exports buckets, and the
 * DynamoDB cache/rate-limit table. See SYSTEM_DESIGN.md §7.1-§7.3.
 *
 * No RDS Proxy — locked decision E2E_MVP_PLAN.md §10 Q1: direct Postgres
 * connections first, RDS Proxy only if a later connection-load spike shows
 * failures.
 *
 * "Account-managed KMS key" in SYSTEM_DESIGN.md §13.1 is interpreted as the
 * AWS-managed default key (`aws/rds`), not a customer-managed key we'd
 * create and pay for — consistent with DynamoDB's parallel "AWS-owned key"
 * line one paragraph below it, and with the cost-discipline theme running
 * through PRD.md §17.4. No `kms.Key` resource is created in this stack.
 */
export class DataStack extends cdk.Stack {
  public readonly dbCluster: DatabaseCluster;
  public readonly uploadsBucket: Bucket;
  public readonly exportsBucket: Bucket;
  public readonly cacheTable: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { envName } = props;
    // aws-cdk-lib's own `SecurityGroup`/`DatabaseCluster` constructs declare
    // `vpc: IVpc`, and assigning the concrete `Vpc` class to that fails under
    // `exactOptionalPropertyTypes` — a structural mismatch on one optional
    // field (`vpnGatewayId`) in aws-cdk-lib's types, not a real unsoundness:
    // `Vpc` implements every member `IVpc` needs at runtime. Narrow, documented
    // cast at the one point it's needed, rather than disabling the strict flag
    // project-wide (which has already caught two real bugs elsewhere).
    const vpc = props.vpc as IVpc;

    // No ingress rules yet — api-stack adds a specific rule for its Lambda
    // security group once it exists. Opening to the whole VPC CIDR now
    // would be broader access than anything currently needs.
    const dbSecurityGroup = new SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Aurora Serverless v2 cluster - ingress added by api-stack',
      allowAllOutbound: true,
    });

    this.dbCluster = new DatabaseCluster(this, 'AuroraCluster', {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_16_4,
      }),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      writer: ClusterInstance.serverlessV2('Writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      // Minimum allowed value (300s = 5 min) — cost discipline is the
      // explicit priority (PRD.md §17.4 lever #2, "non-negotiable"), so pause
      // as aggressively as AWS permits rather than picking a larger margin.
      serverlessV2AutoPauseDuration: cdk.Duration.minutes(5),
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
      credentials: Credentials.fromGeneratedSecret('parimaan_admin'),
    });

    // dev is explicitly disposable/iterative (SYSTEM_DESIGN.md §12.1) — RETAIN
    // there just leaves orphaned, silently cost-accruing resources behind
    // every `cdk destroy`. prod holds real uploaded/exported user data, where
    // RETAIN is the correct protection against accidental deletion.
    const bucketRemovalPolicy =
      envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.uploadsBucket = new Bucket(this, 'UploadsBucket', {
      bucketName: `parimaan-uploads-${envName}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: bucketRemovalPolicy,
    });

    this.exportsBucket = new Bucket(this, 'ExportsBucket', {
      bucketName: `parimaan-exports-${envName}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: bucketRemovalPolicy,
      lifecycleRules: [{ enabled: true, expiration: cdk.Duration.days(30) }],
    });

    // Always DESTROY, regardless of env — this table holds only TTL-expiring
    // cache/rate-limit data (SYSTEM_DESIGN.md §7.3), never anything worth
    // retaining through a stack teardown in any environment.
    this.cacheTable = new Table(this, 'CacheTable', {
      tableName: `parimaan-cache-${envName}`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
