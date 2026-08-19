import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';

/**
 * Proves `migrationsDirOverride` actually changes which directory
 * node-pg-migrate reads from, rather than being silently ignored in favor of
 * the module's own `migrationsDir` constant. An empty temp directory is the
 * clearest possible signal: if the override were ignored, this would apply
 * the real `api/migrations/` set (2 migrations) instead of 0.
 */
describe('runMigrations with a migrationsDirOverride', () => {
  const POSTGRES_IMAGE = 'postgres:16';
  let container: StartedPostgreSqlContainer;
  let emptyMigrationsDir: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    emptyMigrationsDir = await mkdtemp(join(tmpdir(), 'parimaan-empty-migrations-'));
  });

  afterAll(async () => {
    await container.stop();
    await rm(emptyMigrationsDir, { recursive: true, force: true });
  });

  it('reads migrations from the override directory instead of the default one', async () => {
    const result = await runMigrations(container.getConnectionUri(), 'up', emptyMigrationsDir);
    expect(result).toHaveLength(0);
  });
});
