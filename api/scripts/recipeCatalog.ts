import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * B3-0 — read-only view of `docs/catalog/ingredients.csv` for the curated
 * recipe lint. Parsed at validation time so there is no generated artefact
 * to drift from the signed-off catalog.
 */
export interface CatalogIngredient {
  readonly id: string;
  readonly canonicalName: string;
  readonly appCategory: string;
  readonly aliases: readonly string[];
  readonly allowedUnits: readonly string[];
}

export interface IngredientCatalog {
  /** Canonical name (exact case) -> ingredient. */
  readonly byCanonical: ReadonlyMap<string, CatalogIngredient>;
  /** Lower-cased alias -> every ingredient carrying it (aliases can collide). */
  readonly byAlias: ReadonlyMap<string, readonly CatalogIngredient[]>;
}

const REQUIRED_COLUMNS = ['id', 'canonical_name', 'app_category', 'aliases', 'allowed_units'] as const;

/** Minimal RFC-4180 line splitter: handles double-quoted fields with commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const splitPipes = (value: string): string[] =>
  value
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export function parseCatalogCsv(text: string): IngredientCatalog {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = splitCsvLine(lines[0] ?? '');
  const column = new Map(header.map((name, index) => [name.trim(), index]));
  for (const required of REQUIRED_COLUMNS) {
    if (!column.has(required)) {
      throw new Error(`ingredients.csv is missing required column "${required}"`);
    }
  }
  const at = (fields: readonly string[], name: (typeof REQUIRED_COLUMNS)[number]): string =>
    fields[column.get(name) as number] ?? '';

  const byCanonical = new Map<string, CatalogIngredient>();
  const aliasBuckets = new Map<string, CatalogIngredient[]>();
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const ingredient: CatalogIngredient = {
      id: at(fields, 'id'),
      canonicalName: at(fields, 'canonical_name'),
      appCategory: at(fields, 'app_category'),
      aliases: splitPipes(at(fields, 'aliases')),
      allowedUnits: splitPipes(at(fields, 'allowed_units')),
    };
    byCanonical.set(ingredient.canonicalName, ingredient);
    for (const alias of ingredient.aliases) {
      const key = alias.toLowerCase();
      aliasBuckets.set(key, [...(aliasBuckets.get(key) ?? []), ingredient]);
    }
  }
  return { byCanonical, byAlias: aliasBuckets };
}

/** `docs/catalog/ingredients.csv`, two directories above `api/scripts/`. */
export function repoCatalogPath(): string {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  return join(scriptDir, '..', '..', 'docs', 'catalog', 'ingredients.csv');
}

let cachedRepoCatalog: IngredientCatalog | undefined;

export function loadRepoCatalog(): IngredientCatalog {
  cachedRepoCatalog ??= parseCatalogCsv(readFileSync(repoCatalogPath(), 'utf-8'));
  return cachedRepoCatalog;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] as number;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] as number;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(above + 1, (previous[j - 1] as number) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[b.length] as number;
}

const words = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Closest canonical names for an unknown ingredient name: shared words weigh
 * most, edit distance breaks ties.
 */
export function suggestNames(catalog: IngredientCatalog, name: string, limit = 3): string[] {
  const query = name.toLowerCase();
  const queryWords = new Set(words(name));
  return [...catalog.byCanonical.keys()]
    .map((candidate) => {
      const shared = words(candidate).filter((word) => queryWords.has(word)).length;
      return { candidate, shared, distance: editDistance(query, candidate.toLowerCase()) };
    })
    .sort((x, y) => y.shared - x.shared || x.distance - y.distance || x.candidate.localeCompare(y.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
