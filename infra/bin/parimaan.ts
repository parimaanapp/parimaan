#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../stacks/api-stack';
import { AuthStack } from '../stacks/auth-stack';
import { DataStack } from '../stacks/data-stack';
import { NetworkStack } from '../stacks/network-stack';

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

const network = new NetworkStack(app, `Parimaan-${envName}-Network`, {
  env,
  envName,
  description: `Parimaan ${envName} — VPC, subnets, and gateway/interface endpoints.`,
});

const data = new DataStack(app, `Parimaan-${envName}-Data`, {
  env,
  envName,
  vpc: network.vpc,
  description: `Parimaan ${envName} — Aurora Serverless v2, S3 buckets, DynamoDB cache table.`,
});

// Google OAuth Client ID is not sensitive (client IDs are meant to be public),
// so it's passed as CDK context rather than Secrets Manager — the Client
// *Secret* is what's sensitive, and AuthStack sources that directly from
// Secrets Manager (parimaan/google-oauth-secret), never through this file.
//   pnpm cdk synth -c env=dev -c googleClientId=<id>.apps.googleusercontent.com
const googleClientId = app.node.tryGetContext('googleClientId') as string | undefined;
if (!googleClientId) {
  throw new Error(
    'Missing CDK context "googleClientId". Pass it explicitly, e.g. ' +
      '`pnpm cdk synth -c env=dev -c googleClientId=<id>.apps.googleusercontent.com`.',
  );
}

const auth = new AuthStack(app, `Parimaan-${envName}-Auth`, {
  env,
  envName,
  googleClientId,
  description: `Parimaan ${envName} — Cognito user pool, Google IdP, app clients.`,
});

new ApiStack(app, `Parimaan-${envName}-Api`, {
  env,
  envName,
  userPool: auth.userPool,
  vpc: network.vpc,
  dbCluster: data.dbCluster,
  appRoleSecret: data.appRoleSecret,
  lambdaSecurityGroup: data.lambdaSecurityGroup,
  description: `Parimaan ${envName} — AppSync GraphQL API + Lambda resolvers.`,
});

cdk.Tags.of(app).add('Project', 'Parimaan');
cdk.Tags.of(app).add('Environment', envName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
