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
 * Two private subnet groups exist side by side, for two genuinely different
 * needs (W17 §23.2.1 D1):
 *
 * - `isolated` (`PRIVATE_ISOLATED`) — the original, still-default group.
 *   Aurora and every DB-only Lambda (`createDbResolverFunction`'s default
 *   `vpcSubnets` in `api-stack.ts`) live here, with zero internet route.
 *   This is deliberate defense-in-depth for the database and is UNCHANGED
 *   by this week's work — covered by the Gateway/Interface VPC endpoints
 *   below for S3/DynamoDB/Bedrock/Secrets Manager/Lambda traffic, no NAT
 *   Gateway needed for anything that only ever talks to AWS services.
 * - `private-egress` (`PRIVATE_WITH_EGRESS`) — new. Through W16, every
 *   Lambda needed either DB access (the `isolated` group above) or public
 *   internet access (W7's non-VPC AI Lambdas, no VPC membership at all) —
 *   never both in the same execution, so `natGateways: 0` (no recurring
 *   NAT cost) was the right call. W17's `staplesNoteFn` is the first
 *   Lambda that needs both real Aurora access AND real internet egress
 *   (no AWS PrivateLink exists for Gemini's public HTTPS endpoint) in one
 *   execution. Only a Lambda that opts in via `createDbResolverFunction`'s
 *   `needsInternetEgress` flag (`api-stack.ts`) is placed here instead of
 *   the isolated default — this group exists ALONGSIDE, never replacing,
 *   `isolated`.
 *
 * `natGateways: 1` (single-AZ, not 2) — this feature is explicitly
 * best-effort/non-blocking (W17 §23.2.2 D5), so a single NAT Gateway's
 * availability profile is an acceptable trade for half the cost.
 * Founder-confirmed: AWS Activate credits are active on this account,
 * making the ~$32-35/mo cost immaterial against the credit balance
 * (PRD.md §17.4's cost-discipline lever no longer forces zero NAT
 * Gateways once cost is immaterial — the original `natGateways: 0`
 * reasoning below still explains why it was the right default through W16).
 *
 * See SYSTEM_DESIGN.md §12.3 for this stack's role among the other five.
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'private-egress', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // Lets Lambda resolvers reach S3/DynamoDB/Bedrock/Secrets Manager
    // without a NAT Gateway. Every endpoint below is now explicitly scoped
    // to the subnet groups it already covered before this week's
    // `private-egress` group existed — without doing so, CDK's default
    // subnet-selection (now that a second/third subnet group exists) picks
    // up the new group too, which would silently MODIFY these already-
    // deployed endpoints' route-table/ENI placement — a real change to
    // existing resources, not a pure addition, and exactly what W17
    // §23.2.1 D1's own verification requirement (`cdk diff` shows
    // additions only) rules out. Confirmed by two real `cdk diff` passes
    // against `Parimaan-dev-Network` while getting this right: the first
    // (no explicit `subnets` at all) moved `Vpc/Bedrock`/
    // `Vpc/SecretsManager`'s `SubnetIds` onto the new egress subnets and
    // added the egress route tables to `Vpc/S3`/`Vpc/DynamoDb`'s
    // `RouteTableIds`; the second (restricted to `isolated` only, the fix
    // one line below would have been for the interface endpoints alone)
    // *dropped* the public subnets' route tables from the two gateway
    // endpoints, because their original, pre-W17 default selection was
    // "every subnet in the VPC" (public + isolated), not "isolated only" —
    // gateway endpoints (S3/DynamoDB) and interface endpoints
    // (Bedrock/Secrets Manager) had different implicit defaults, so each
    // needed a different explicit fix to reproduce its own prior scope
    // exactly, excluding only the new `private-egress` group from both.
    const isolatedSubnets = { subnetType: SubnetType.PRIVATE_ISOLATED };
    const publicSubnets = { subnetType: SubnetType.PUBLIC };
    this.vpc.addGatewayEndpoint('S3', {
      service: GatewayVpcEndpointAwsService.S3,
      subnets: [isolatedSubnets, publicSubnets],
    });
    this.vpc.addGatewayEndpoint('DynamoDb', {
      service: GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [isolatedSubnets, publicSubnets],
    });
    this.vpc.addInterfaceEndpoint('Bedrock', {
      service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      subnets: isolatedSubnets,
    });
    this.vpc.addInterfaceEndpoint('SecretsManager', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: isolatedSubnets,
    });
    // W17 §23.5 fix — `generateShoppingList`/`regenerateShoppingList` stay
    // in `isolated` (needsInternetEgress: false, unchanged) but fire an
    // async `lambda:InvokeFunction` control-plane call to `staplesNoteFn`
    // after their own transaction commits
    // (`api/src/aiInvoke/staplesNoteInvoker.ts`). `isolated` has no route
    // to the internet and, until this endpoint, no VPC endpoint for the
    // Lambda service either, so that outbound call had nowhere to go: it
    // hung silently (no error, no timeout signal) until the calling
    // function died at its own 45s timeout — confirmed live against real
    // dev. This endpoint lets every isolated-subnet Lambda reach the Lambda
    // control-plane API over AWS PrivateLink (never the public internet),
    // scoped to `isolated` only, exactly mirroring Bedrock/Secrets Manager
    // above — the isolated subnet's "zero internet route" property stays
    // completely intact.
    this.vpc.addInterfaceEndpoint('Lambda', {
      service: InterfaceVpcEndpointAwsService.LAMBDA,
      subnets: isolatedSubnets,
    });
  }
}
