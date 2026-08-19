import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbConfig } from './config.js';
import { getPool, resetPoolForTesting } from './pool.js';

/**
 * Testcontainers-shaped connection params, injected directly rather than
 * fetched from Secrets Manager — per the task's own instruction, pool
 * construction tests should never touch AWS in-process. `fetchAppRolePassword`
 * is the injectable seam that lets `getPool` never need to know whether its
 * password came from Secrets Manager (production) or a hardcoded test
 * container password (tests).
 */
const testConfig: DbConfig = {
  appRoleSecretArn: 'unused-in-tests',
  dbHost: '127.0.0.1',
  dbPort: 55432,
  dbName: 'parimaan_test',
};

describe('getPool', () => {
  afterEach(async () => {
    await resetPoolForTesting();
  });

  it('constructs a Pool using the injected config and password fetcher, never touching Secrets Manager', async () => {
    const fetchAppRolePassword = vi.fn().mockResolvedValue('test-password');

    const pool = await getPool({ config: testConfig, fetchAppRolePassword });

    expect(pool).toBeDefined();
    expect(fetchAppRolePassword).toHaveBeenCalledTimes(1);
  });

  it('memoizes: a second call returns the identical Pool instance without re-fetching the password', async () => {
    const fetchAppRolePassword = vi.fn().mockResolvedValue('test-password');

    const first = await getPool({ config: testConfig, fetchAppRolePassword });
    const second = await getPool({ config: testConfig, fetchAppRolePassword });

    expect(second).toBe(first);
    expect(fetchAppRolePassword).toHaveBeenCalledTimes(1);
  });

  it('resetPoolForTesting ends the pool cleanly, and a subsequent getPool call rebuilds it', async () => {
    const fetchAppRolePassword = vi.fn().mockResolvedValue('test-password');

    const first = await getPool({ config: testConfig, fetchAppRolePassword });
    await resetPoolForTesting();
    const second = await getPool({ config: testConfig, fetchAppRolePassword });

    expect(second).not.toBe(first);
    expect(fetchAppRolePassword).toHaveBeenCalledTimes(2);
  });
});
