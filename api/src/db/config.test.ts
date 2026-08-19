import { describe, expect, it } from 'vitest';
import { loadDbConfig } from './config.js';

const validEnv = {
  APP_ROLE_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:app-role-abc123',
  DB_HOST: 'db.example.internal',
  DB_PORT: '5432',
  DB_NAME: 'parimaan',
};

describe('loadDbConfig', () => {
  it('parses a fully-populated env into a DbConfig', () => {
    const config = loadDbConfig(validEnv);
    expect(config).toEqual({
      appRoleSecretArn: validEnv.APP_ROLE_SECRET_ARN,
      dbHost: validEnv.DB_HOST,
      dbPort: 5432,
      dbName: validEnv.DB_NAME,
    });
  });

  it('never requires DB_SECRET_ARN — these resolvers connect as parimaan_app only, never the cluster admin credentials', () => {
    expect(() => loadDbConfig({ ...validEnv, DB_SECRET_ARN: undefined })).not.toThrow();
  });

  it('coerces DB_PORT to a number', () => {
    const config = loadDbConfig(validEnv);
    expect(config.dbPort).toBe(5432);
    expect(typeof config.dbPort).toBe('number');
  });

  it.each(['APP_ROLE_SECRET_ARN', 'DB_HOST', 'DB_PORT', 'DB_NAME'] as const)(
    'throws naming %s when it is missing',
    (missingKey) => {
      const rest = { ...validEnv };
      delete rest[missingKey];
      expect(() => loadDbConfig(rest)).toThrow(new RegExp(missingKey));
    },
  );

  it('throws when DB_PORT is not a valid integer', () => {
    expect(() => loadDbConfig({ ...validEnv, DB_PORT: 'not-a-port' })).toThrow(/DB_PORT/);
  });

  it('throws when DB_HOST is an empty string', () => {
    expect(() => loadDbConfig({ ...validEnv, DB_HOST: '' })).toThrow(/DB_HOST/);
  });
});
