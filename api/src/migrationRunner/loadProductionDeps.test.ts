import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProductionDeps } from './loadProductionDeps.js';

const REQUIRED_ENV_VARS = [
  'DB_SECRET_ARN',
  'APP_ROLE_SECRET_ARN',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
] as const;

const VALID_ENV: Record<(typeof REQUIRED_ENV_VARS)[number], string> = {
  DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-admin',
  APP_ROLE_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:app-role',
  DB_HOST: 'db.example.internal',
  DB_PORT: '5432',
  DB_NAME: 'parimaan',
};

describe('loadProductionDeps', () => {
  const originalValues: Record<(typeof REQUIRED_ENV_VARS)[number], string | undefined> = {
    DB_SECRET_ARN: undefined,
    APP_ROLE_SECRET_ARN: undefined,
    DB_HOST: undefined,
    DB_PORT: undefined,
    DB_NAME: undefined,
  };

  beforeEach(() => {
    for (const key of REQUIRED_ENV_VARS) {
      originalValues[key] = process.env[key];
      process.env[key] = VALID_ENV[key];
    }
  });

  afterEach(() => {
    for (const key of REQUIRED_ENV_VARS) {
      const original = originalValues[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it('builds deps with all required env vars set', () => {
    const deps = loadProductionDeps();
    expect(deps.dbHost).toBe(VALID_ENV.DB_HOST);
    expect(deps.dbPort).toBe(5432);
    expect(deps.dbName).toBe(VALID_ENV.DB_NAME);
  });

  it.each(REQUIRED_ENV_VARS)('throws naming %s when it is unset', (missingVar) => {
    delete process.env[missingVar];
    expect(() => loadProductionDeps()).toThrow(new RegExp(missingVar));
  });
});
