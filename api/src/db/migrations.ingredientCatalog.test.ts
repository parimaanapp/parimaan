import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';
import {
  APP_ROLE,
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  firstRow,
  getColumnTypes,
  tableExists,
} from './migrationTestHelpers.js';

const CATALOG_TABLES = [
  'ingredient_catalog',
  'ingredient_aliases',
  'unit_conversions',
  'catalog_sync_state',
] as const;

describe('ingredient catalog tables, once migrated', () => {
  let container: StartedPostgreSqlContainer;
  let admin: Client;
  let app: Client;

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    admin = new Client({ connectionString: container.getConnectionUri() });
    await admin.connect();

    const appUri = new URL(container.getConnectionUri());
    appUri.username = APP_ROLE;
    appUri.password = APP_ROLE_TEST_PASSWORD;
    app = new Client({ connectionString: appUri.toString() });
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
    await container.stop();
  });

  it('creates every catalog table', async () => {
    for (const table of CATALOG_TABLES) {
      expect(await tableExists(admin, table), table).toBe(true);
    }
  });

  it('has the documented ingredient_catalog columns', async () => {
    expect(await getColumnTypes(admin, 'ingredient_catalog')).toEqual({
      id: 'text',
      canonical_name: 'text',
      app_category: 'text',
      subcategory: 'text',
      allowed_units: 'ARRAY',
      default_unit: 'text',
      piece_g: 'numeric',
      cup_g: 'numeric',
      note: 'text',
    });
  });

  it('has the documented alias and conversion columns', async () => {
    expect(await getColumnTypes(admin, 'ingredient_aliases')).toEqual({
      alias_key: 'text',
      ingredient_id: 'text',
      alias_display: 'text',
    });
    expect(await getColumnTypes(admin, 'unit_conversions')).toEqual({
      scope: 'text',
      key: 'text',
      unit: 'text',
      base_unit: 'text',
      amount: 'numeric',
    });
  });

  it('grants the app role SELECT but no writes on the catalog tables', async () => {
    for (const table of ['ingredient_catalog', 'ingredient_aliases', 'unit_conversions']) {
      await expect(app.query(`SELECT 1 FROM ${table} LIMIT 1`)).resolves.toBeDefined();
      await expect(
        app.query(`DELETE FROM ${table}`),
        `${table} DELETE`,
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      app.query(
        `INSERT INTO ingredient_catalog (id, canonical_name, app_category, subcategory, allowed_units, default_unit)
         VALUES ('x', 'X', 'other', 'other', ARRAY['g'], 'g')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('does not expose the sync bookkeeping table to the app role', async () => {
    await expect(app.query('SELECT 1 FROM catalog_sync_state')).rejects.toThrow(/permission denied/);
  });

  it('rejects an ingredient whose default unit is not allowed', async () => {
    await expect(
      admin.query(
        `INSERT INTO ingredient_catalog (id, canonical_name, app_category, subcategory, allowed_units, default_unit)
         VALUES ('bad', 'Bad', 'other', 'other', ARRAY['g'], 'cup')`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('enforces unique canonical names', async () => {
    await admin.query(
      `INSERT INTO ingredient_catalog (id, canonical_name, app_category, subcategory, allowed_units, default_unit)
       VALUES ('one', 'Same Name', 'other', 'other', ARRAY['g'], 'g')`,
    );
    await expect(
      admin.query(
        `INSERT INTO ingredient_catalog (id, canonical_name, app_category, subcategory, allowed_units, default_unit)
         VALUES ('two', 'Same Name', 'other', 'other', ARRAY['g'], 'g')`,
      ),
    ).rejects.toThrow(/unique/i);
    await admin.query(`DELETE FROM ingredient_catalog WHERE id = 'one'`);
  });

  it('allows one alias key to belong to several ingredients (collisions are data, not errors)', async () => {
    await admin.query(
      `INSERT INTO ingredient_catalog (id, canonical_name, app_category, subcategory, allowed_units, default_unit)
       VALUES ('a', 'A', 'other', 'other', ARRAY['g'], 'g'), ('b', 'B', 'other', 'other', ARRAY['g'], 'g')`,
    );
    await admin.query(
      `INSERT INTO ingredient_aliases (alias_key, ingredient_id, alias_display)
       VALUES ('shared', 'a', 'Shared'), ('shared', 'b', 'shared')`,
    );
    await expect(
      admin.query(
        `INSERT INTO ingredient_aliases (alias_key, ingredient_id, alias_display) VALUES ('shared', 'a', 'again')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    const count = firstRow(
      (await admin.query<{ n: string }>(`SELECT count(*) AS n FROM ingredient_aliases WHERE alias_key = 'shared'`)).rows,
    );
    expect(count.n).toBe('2');

    // aliases cascade with their ingredient
    await admin.query(`DELETE FROM ingredient_catalog WHERE id IN ('a', 'b')`);
    const left = firstRow(
      (await admin.query<{ n: string }>(`SELECT count(*) AS n FROM ingredient_aliases`)).rows,
    );
    expect(left.n).toBe('0');
  });

  it('rejects a conversion with a bad scope or a non-positive amount', async () => {
    await expect(
      admin.query(
        `INSERT INTO unit_conversions (scope, key, unit, base_unit, amount) VALUES ('galaxy', 'k', 'cup', 'g', 1)`,
      ),
    ).rejects.toThrow(/check/i);
    await expect(
      admin.query(
        `INSERT INTO unit_conversions (scope, key, unit, base_unit, amount) VALUES ('subcategory', 'k', 'cup', 'g', 0)`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('can be reversed and re-applied (down then up)', async () => {
    await runMigrations(container.getConnectionUri(), 'down', undefined, [], 1);
    expect(await tableExists(admin, 'ingredient_catalog')).toBe(false);
    await runMigrations(container.getConnectionUri(), 'up');
    expect(await tableExists(admin, 'ingredient_catalog')).toBe(true);
  });
});
