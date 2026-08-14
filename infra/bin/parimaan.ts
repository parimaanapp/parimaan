#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BootstrapStack } from '../stacks/bootstrap-stack';

const app = new cdk.App();

// Environment is supplied at invocation time — never hardcoded.
//   pnpm cdk synth -c env=dev
const envName = app.node.tryGetContext('env') as string | undefined;
if (envName !== 'dev' && envName !== 'prod') {
  throw new Error(
    `Missing or invalid CDK context "env". Expected "dev" or "prod", received: ${String(envName)}. ` +
      `Pass it explicitly, e.g. \`pnpm cdk synth -c env=dev\`.`,
  );
}

// Account and region come from the ambient AWS credentials/profile
// (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION), never from committed source.
// Built conditionally (not `{ account: possiblyUndefined }`) because
// exactOptionalPropertyTypes rejects an explicit `undefined` assigned to an
// optional property — the property must be absent, not present-but-undefined.
const env: cdk.Environment = {
  ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}),
  ...(process.env.CDK_DEFAULT_REGION ? { region: process.env.CDK_DEFAULT_REGION } : {}),
};

new BootstrapStack(app, `Parimaan-${envName}-Bootstrap`, {
  env,
  envName,
  description: `Parimaan ${envName} — bootstrap/placeholder stack (Sprint 0). Real stacks land in W1.`,
});

cdk.Tags.of(app).add('Project', 'Parimaan');
cdk.Tags.of(app).add('Environment', envName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
