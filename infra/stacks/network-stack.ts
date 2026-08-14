import * as cdk from 'aws-cdk-lib';
import {
  GatewayVpcEndpointAwsService,
  InterfaceVpcEndpointAwsService,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
}

/**
 * Shared VPC for Parimaan's Lambda resolvers and Aurora Serverless v2 cluster.
 *
 * No NAT Gateway (`natGateways: 0`) — VPC endpoints cover S3, DynamoDB,
 * Bedrock, and Secrets Manager traffic instead, which is materially cheaper
 * at this traffic pattern (PRD.md §17.4 lever notes cost discipline as a
 * running constraint; a NAT Gateway costs ~$32/mo + data transfer that these
 * endpoints avoid entirely).
 *
 * See SYSTEM_DESIGN.md §12.3 for this stack's role among the other five.
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Lets Lambda resolvers reach S3/DynamoDB/Bedrock/Secrets Manager
    // without a NAT Gateway.
    this.vpc.addGatewayEndpoint('S3', { service: GatewayVpcEndpointAwsService.S3 });
    this.vpc.addGatewayEndpoint('DynamoDb', { service: GatewayVpcEndpointAwsService.DYNAMODB });
    this.vpc.addInterfaceEndpoint('Bedrock', {
      service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
    });
    this.vpc.addInterfaceEndpoint('SecretsManager', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
  }
}
