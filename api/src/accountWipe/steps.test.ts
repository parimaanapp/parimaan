import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DELETE_STEPS, GLOBAL_REFERENCE_TABLES, qualifiedTable } from './steps.js';

const MIGRATIONS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../migrations');

interface FkEdge {
  readonly child: string;
  readonly parent: string;
}

const readMigrations = (): string =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');

/** Derives every FK edge (child -> parent) and every created table from the migration SQL. */
const parseSchema = (sql: string): { tables: Set<string>; edges: FkEdge[] } => {
  const tables = new Set<string>();
  const edges: FkEdge[] = [];
  const createRe = /CREATE TABLE (\w+) \(([\s\S]*?)\n\s*\);/g;
  for (const match of sql.matchAll(createRe)) {
    const table = match[1] as string;
    tables.add(table);
    for (const ref of (match[2] as string).matchAll(/REFERENCES (\w+)\(/g)) {
      edges.push({ child: table, parent: ref[1] as string });
    }
  }
  const alterRe = /ALTER TABLE (\w+)[^;]*?FOREIGN KEY \(\w+\) REFERENCES (\w+)\(/g;
  for (const match of sql.matchAll(alterRe)) {
    edges.push({ child: match[1] as string, parent: match[2] as string });
  }
  return { tables, edges };
};

describe('DELETE_STEPS (FK graph derived from api/migrations)', () => {
  const parsed = parseSchema(readMigrations());
  const isGlobal = (table: string): boolean => GLOBAL_REFERENCE_TABLES.includes(table);
  const tables = new Set([...parsed.tables].filter((table) => !isGlobal(table)));
  const edges = parsed.edges.filter(({ child }) => !isGlobal(child));
  const order = DELETE_STEPS.map((s) => s.table);

  it('parses a plausible schema', () => {
    expect(tables.size).toBeGreaterThanOrEqual(12);
    expect(edges.length).toBeGreaterThanOrEqual(15);
  });

  it('covers every table created by a migration (a new table must be added deliberately)', () => {
    expect([...tables].sort()).toEqual([...order].sort());
  });

  it('keeps global reference tables out of the wipe, and they exist in the migrations', () => {
    for (const table of GLOBAL_REFERENCE_TABLES) {
      expect(parsed.tables.has(table), table).toBe(true);
      expect(order, table).not.toContain(table);
    }
  });

  it('deletes every child table before the table it references', () => {
    for (const { child, parent } of edges) {
      expect(order.indexOf(child), `${child} must precede ${parent}`).toBeLessThan(
        order.indexOf(parent),
      );
    }
  });
});

describe('schema qualification (L6/L7)', () => {
  it('migrations create tables in the default (public) schema only', () => {
    const sql = readMigrations();
    expect(sql).not.toMatch(/CREATE SCHEMA/i);
    expect(sql).not.toMatch(/SET search_path/i);
  });

  it('qualifies every step table with public.', () => {
    for (const step of DELETE_STEPS) {
      expect(qualifiedTable(step)).toBe(`public.${step.table}`);
    }
  });

  it('qualifies every table referenced inside a step predicate', () => {
    for (const step of DELETE_STEPS) {
      const refs = [...step.where.matchAll(/\bFROM\s+([\w.]+)/g)].map((m) => m[1] as string);
      for (const ref of refs) expect(ref, step.table).toMatch(/^public\./);
    }
  });
});
