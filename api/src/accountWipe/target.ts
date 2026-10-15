import { DescribeUserPoolCommand } from '@aws-sdk/client-cognito-identity-provider';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { SendClient } from './awsPorts.js';
import type { TargetInfo, TargetVerifier } from './types.js';

export interface ExpectedTarget {
  readonly accountId: string;
  readonly poolName: string;
  readonly dbHost: string;
}

export interface TargetVerifierOptions {
  readonly sts: SendClient;
  readonly cognito: SendClient;
  readonly userPoolId: string;
  /** The host the database connection really terminates at (TLS-verified). */
  readonly dbHost: string;
  readonly expected: ExpectedTarget;
}

/**
 * Binds the dev-only guard to the real targets, failing closed. Name suffixes
 * and `WIPE_ENV` are only self-assertions; this checks what the credentials and
 * connection actually point at before anything is listed or deleted.
 */
export const createTargetVerifier = (options: TargetVerifierOptions): TargetVerifier => ({
  verify: async (): Promise<TargetInfo> => {
    const identity = await options.sts.send(new GetCallerIdentityCommand({}));
    const accountId = String(identity?.Account ?? '');
    if (accountId !== options.expected.accountId) {
      throw new Error(
        `Refusing to run: AWS account ${accountId || '(unknown)'} is not the expected account ${options.expected.accountId}.`,
      );
    }

    const described = await options.cognito.send(
      new DescribeUserPoolCommand({ UserPoolId: options.userPoolId }),
    );
    const userPoolName = String(described?.UserPool?.Name ?? '');
    if (userPoolName !== options.expected.poolName) {
      throw new Error(
        `Refusing to run: user pool ${options.userPoolId} is named "${userPoolName}", expected "${options.expected.poolName}".`,
      );
    }

    if (options.dbHost.toLowerCase() !== options.expected.dbHost.toLowerCase()) {
      throw new Error(
        `Refusing to run: database host "${options.dbHost}" is not the expected host "${options.expected.dbHost}".`,
      );
    }

    return {
      accountId,
      userPoolId: options.userPoolId,
      userPoolName,
      dbHost: options.dbHost,
    };
  },
});
