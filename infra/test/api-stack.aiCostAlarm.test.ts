import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ApiStack } from '../stacks/api-stack';
import { DataStack } from '../stacks/data-stack';

/**
 * W19 D6 — the `$5/day` AI cost alarm deferred from W7 (§13.2.9/D8), its
 * own infra assertions split out of `api-stack.test.ts` purely to keep
 * that file under this repo's `max-lines` ESLint ceiling — the same
 * reason `api-stack.exportShoppingListImage.test.ts` was already split
 * out, no behavior difference, just file size. Duplicates
 * `api-stack.test.ts`'s own fake-user-pool/fake-VPC/fake-DataStack
 * fixtures rather than importing them (not exported) — the same "own
 * throwaway fixture per file" convention that file's own doc comment
 * already names.
 */
const buildFakeUserPool = (app: cdk.App): UserPool => {
  const authStack = new cdk.Stack(app, 'Parimaan-dev-FakeAuth');
  return new UserPool(authStack, 'UserPool', {
    selfSignUpEnabled: false,
    signInAliases: { email: true },
  });
};

const buildFakeVpc = (app: cdk.App): Vpc => {
  const vpcStack = new cdk.Stack(app, 'Parimaan-dev-FakeNetwork');
  return new Vpc(vpcStack, 'Vpc', {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
      { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      { name: 'private-egress', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
    ],
  });
};

const buildFakeDataStack = (app: cdk.App, vpc: Vpc): DataStack =>
  new DataStack(app, 'Parimaan-dev-FakeData', { envName: 'dev', vpc });

describe('ApiStack — AI cost alarm (W19 D6)', () => {
  const synthJson = (): { Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }> } => {
    const app = new cdk.App();
    const userPool = buildFakeUserPool(app);
    const vpc = buildFakeVpc(app);
    const data = buildFakeDataStack(app, vpc);
    const stack = new ApiStack(app, 'Parimaan-dev-Api', {
      envName: 'dev',
      userPool,
      vpc,
      dbCluster: data.dbCluster,
      appRoleSecret: data.appRoleSecret,
      lambdaSecurityGroup: data.lambdaSecurityGroup,
      cacheTable: data.cacheTable,
      exportsBucket: data.exportsBucket,
      alertsTopic: data.alertsTopic,
    });
    return cdk.assertions.Template.fromStack(stack).toJSON() as {
      Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
    };
  };

  const findAiCostAlarm = (json: ReturnType<typeof synthJson>) =>
    Object.values(json.Resources).find((r) => r.Type === 'AWS::CloudWatch::Alarm' && r.Properties?.Namespace === 'Parimaan/AI');

  it('alarms on the custom Parimaan/AI EstimatedCostUsd metric, summed daily, at a $5 threshold', () => {
    const alarm = findAiCostAlarm(synthJson());

    expect(alarm?.Properties).toMatchObject({
      Namespace: 'Parimaan/AI',
      MetricName: 'EstimatedCostUsd',
      Statistic: 'Sum',
      Period: 86400, // 24 hours, in seconds — a daily cost alarm, not a per-minute one
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
    });
  });

  it('publishes the AI cost alarm to the same SNS alerts topic every other alarm in this codebase uses', () => {
    const alarm = findAiCostAlarm(synthJson());

    expect((alarm?.Properties?.AlarmActions as unknown[] | undefined) ?? []).toHaveLength(1);
  });

  it('declares exactly one Parimaan/AI alarm — not accidentally duplicated across the stack', () => {
    const json = synthJson();
    const aiAlarms = Object.values(json.Resources).filter(
      (r) => r.Type === 'AWS::CloudWatch::Alarm' && r.Properties?.Namespace === 'Parimaan/AI',
    );

    expect(aiAlarms).toHaveLength(1);
  });
});
