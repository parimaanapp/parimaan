import { describe, expect, it } from 'vitest';
import { createTargetVerifier } from './target.js';

const expected = {
  accountId: '123456789012',
  poolName: 'parimaan-dev',
  dbHost: 'db.dev.rds.test',
  dbName: 'parimaan',
};
const resources = {
  region: 'ap-south-1',
  uploadsBucket: 'parimaan-uploads-dev',
  exportsBucket: 'parimaan-exports-dev',
  cacheTable: 'parimaan-cache-dev',
};

const clients = (overrides: { account?: string; poolName?: string; fail?: 'sts' | 'cognito' } = {}) => {
  const sent: string[] = [];
  const sts = {
    send: async (c: { constructor: { name: string } }) => {
      sent.push(c.constructor.name);
      if (overrides.fail === 'sts') throw new Error('sts down');
      return { Account: overrides.account ?? expected.accountId };
    },
  };
  const cognito = {
    send: async (c: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push(c.constructor.name);
      if (overrides.fail === 'cognito') throw new Error('cognito down');
      return { UserPool: { Id: c.input['UserPoolId'], Name: overrides.poolName ?? expected.poolName } };
    },
  };
  return { sts, cognito, sent };
};

const verifier = (
  c: ReturnType<typeof clients>,
  dbHost = expected.dbHost,
  dbName: () => Promise<string> = async () => expected.dbName,
) =>
  createTargetVerifier({
    sts: c.sts,
    cognito: c.cognito,
    userPoolId: 'pool-1',
    dbHost,
    dbName,
    resources,
    expected,
  });

describe('createTargetVerifier', () => {
  it('returns the verified, non-secret target description', async () => {
    const c = clients();
    await expect(verifier(c).verify()).resolves.toEqual({
      accountId: '123456789012',
      userPoolId: 'pool-1',
      userPoolName: 'parimaan-dev',
      dbHost: 'db.dev.rds.test',
      dbName: 'parimaan',
      region: 'ap-south-1',
      uploadsBucket: 'parimaan-uploads-dev',
      exportsBucket: 'parimaan-exports-dev',
      cacheTable: 'parimaan-cache-dev',
    });
    expect(c.sent).toEqual(['GetCallerIdentityCommand', 'DescribeUserPoolCommand']);
  });

  it('fails closed when the AWS account is not the expected one', async () => {
    await expect(verifier(clients({ account: '999999999999' })).verify()).rejects.toThrow(
      /account/i,
    );
  });

  it('fails closed when the user pool name differs', async () => {
    await expect(verifier(clients({ poolName: 'parimaan-prod' })).verify()).rejects.toThrow(
      /user pool/i,
    );
  });

  it('fails closed when the database host differs (case-insensitive otherwise)', async () => {
    await expect(verifier(clients(), 'db.prod.rds.test').verify()).rejects.toThrow(/database host/i);
    await expect(verifier(clients(), 'DB.DEV.RDS.TEST').verify()).resolves.toBeDefined();
  });

  it('fails closed when current_database() is not the expected database name', async () => {
    await expect(verifier(clients(), expected.dbHost, async () => 'postgres').verify()).rejects.toThrow(
      /database name/i,
    );
  });

  it('propagates a failed current_database() lookup instead of guessing', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('db down');
    };
    await expect(verifier(clients(), expected.dbHost, failing).verify()).rejects.toThrow('db down');
  });

  it('propagates lookup failures instead of guessing', async () => {
    await expect(verifier(clients({ fail: 'sts' })).verify()).rejects.toThrow('sts down');
    await expect(verifier(clients({ fail: 'cognito' })).verify()).rejects.toThrow('cognito down');
  });
});
