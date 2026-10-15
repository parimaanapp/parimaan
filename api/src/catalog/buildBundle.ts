import { CATEGORY_LABELS } from '../domain/ingredientCatalog.js';
import type { CatalogEntry } from '../domain/ingredientCatalog.js';
import { parseCsv } from './csv.js';

export interface UnitConversion {
  readonly scope: 'subcategory' | 'ingredient';
  readonly key: string;
  readonly unit: string;
  readonly baseUnit: string;
  readonly amount: number;
}

export interface CatalogBundle {
  readonly ingredients: readonly CatalogEntry[];
  readonly conversions: readonly UnitConversion[];
}

const INGREDIENT_HEADER = [
  'id',
  'canonical_name',
  'app_category',
  'app_category_label',
  'subcategory',
  'aliases',
  'allowed_units',
  'default_unit',
  'piece_g',
  'cup_g_override',
  'note',
] as const;
const CONVERSION_HEADER = [
  'scope',
  'subcategory_or_ingredient',
  'unit',
  'base_unit',
  'amount_per_unit',
] as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9_]*$/;
const LIST_SEPARATOR = '|';

type Row = Readonly<Record<string, string>>;

const toRows = (text: string, header: readonly string[], fileLabel: string): Row[] => {
  const [head, ...body] = parseCsv(text);
  if (head === undefined || head.join(',') !== header.join(',')) {
    throw new Error(`${fileLabel}: unexpected header, expected ${header.join(',')}`);
  }
  return body.map((cells, rowIndex) => {
    if (cells.length !== header.length) {
      throw new Error(`${fileLabel} row ${rowIndex + 2}: expected ${header.length} columns, got ${cells.length}`);
    }
    return Object.fromEntries(header.map((name, column) => [name, (cells[column] ?? '').trim()]));
  });
};

const splitList = (value: string): string[] =>
  value
    .split(LIST_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');

const optionalPositive = (value: string, column: string, id: string): number | null => {
  if (value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`ingredient ${id}: ${column} must be a positive number, got "${value}"`);
  }
  return parsed;
};

const dedupeAliases = (aliases: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    const key = alias.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(alias);
    }
  }
  return result;
};

const cell = (row: Row, column: string): string => row[column] ?? '';

const requireText = (row: Row, column: string, id: string): string => {
  const value = cell(row, column);
  if (value === '') {
    throw new Error(`ingredient ${id}: ${column} is empty`);
  }
  return value;
};

const requireCategory = (row: Row, id: string): string => {
  const category = cell(row, 'app_category');
  const expectedLabel = CATEGORY_LABELS[category];
  if (expectedLabel === undefined) {
    throw new Error(`ingredient ${id}: unknown app_category "${category}"`);
  }
  if (cell(row, 'app_category_label') !== expectedLabel) {
    throw new Error(
      `ingredient ${id}: app_category_label "${cell(row, 'app_category_label')}" does not match approved label "${expectedLabel}"`,
    );
  }
  return category;
};

const requireUnits = (row: Row, id: string): { allowedUnits: string[]; defaultUnit: string } => {
  const allowedUnits = splitList(cell(row, 'allowed_units'));
  if (allowedUnits.length === 0) {
    throw new Error(`ingredient ${id}: allowed_units is empty`);
  }
  const defaultUnit = cell(row, 'default_unit');
  if (!allowedUnits.includes(defaultUnit)) {
    throw new Error(`ingredient ${id}: default_unit "${defaultUnit}" is not in allowed_units`);
  }
  return { allowedUnits, defaultUnit };
};

const toIngredient = (row: Row): CatalogEntry => {
  const id = cell(row, 'id');
  if (!ID_PATTERN.test(id)) {
    throw new Error(`ingredient id "${id}" must match ${ID_PATTERN}`);
  }
  return {
    id,
    canonicalName: requireText(row, 'canonical_name', id),
    appCategory: requireCategory(row, id),
    subcategory: requireText(row, 'subcategory', id),
    aliases: dedupeAliases(splitList(cell(row, 'aliases'))),
    ...requireUnits(row, id),
    pieceG: optionalPositive(cell(row, 'piece_g'), 'piece_g', id),
    cupG: optionalPositive(cell(row, 'cup_g_override'), 'cup_g', id),
    note: cell(row, 'note'),
  };
};

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const toIngredients = (rows: readonly Row[]): CatalogEntry[] => {
  const ids = new Set<string>();
  const names = new Set<string>();
  const entries = rows.map((row) => {
    const entry = toIngredient(row);
    if (ids.has(entry.id)) {
      throw new Error(`duplicate id "${entry.id}"`);
    }
    const nameKey = entry.canonicalName.toLowerCase();
    if (names.has(nameKey)) {
      throw new Error(`duplicate canonical name "${entry.canonicalName}"`);
    }
    ids.add(entry.id);
    names.add(nameKey);
    return entry;
  });
  return entries.sort((a, b) => byString(a.id, b.id));
};

interface ConversionLookups {
  readonly ingredientIds: ReadonlySet<string>;
  readonly subcategories: ReadonlySet<string>;
  /** conversions.csv keys ingredient rows by canonical name; the bundle and table key them by id. */
  readonly idByName: ReadonlyMap<string, string>;
}

const resolveConversionKey = (scope: 'subcategory' | 'ingredient', rawKey: string, lookups: ConversionLookups): string => {
  if (scope === 'subcategory') {
    if (!lookups.subcategories.has(rawKey)) {
      throw new Error(`conversion for unknown subcategory "${rawKey}"`);
    }
    return rawKey;
  }
  const key = lookups.ingredientIds.has(rawKey) ? rawKey : lookups.idByName.get(rawKey.toLowerCase());
  if (key === undefined) {
    throw new Error(`conversion for unknown ingredient "${rawKey}"`);
  }
  return key;
};

const toConversion = (row: Row, lookups: ConversionLookups): UnitConversion => {
  const rawKey = cell(row, 'subcategory_or_ingredient');
  const unit = cell(row, 'unit');
  const scope = row['scope'];
  if (scope !== 'subcategory' && scope !== 'ingredient') {
    throw new Error(`conversion "${rawKey}/${unit}": invalid scope "${scope}"`);
  }
  const key = resolveConversionKey(scope, rawKey, lookups);
  const amount = Number(cell(row, 'amount_per_unit'));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`conversion ${scope}/${key}/${unit}: amount must be a positive number`);
  }
  const baseUnit = cell(row, 'base_unit');
  if (unit === '' || baseUnit === '') {
    throw new Error(`conversion ${scope}/${key}: unit and base_unit are required`);
  }
  return { scope, key, unit, baseUnit, amount };
};

const toConversions = (rows: readonly Row[], ingredients: readonly CatalogEntry[]): UnitConversion[] => {
  const lookups: ConversionLookups = {
    ingredientIds: new Set(ingredients.map((entry) => entry.id)),
    subcategories: new Set(ingredients.map((entry) => entry.subcategory)),
    idByName: new Map(ingredients.map((entry) => [entry.canonicalName.toLowerCase(), entry.id])),
  };
  const seen = new Set<string>();

  const conversions = rows.map((row) => {
    const conversion = toConversion(row, lookups);
    const composite = `${conversion.scope}\u0000${conversion.key}\u0000${conversion.unit}`;
    if (seen.has(composite)) {
      throw new Error(`duplicate conversion ${conversion.scope}/${conversion.key}/${conversion.unit}`);
    }
    seen.add(composite);
    return conversion;
  });

  return conversions.sort(
    (a, b) => byString(a.scope, b.scope) || byString(a.key, b.key) || byString(a.unit, b.unit),
  );
};

/**
 * Converts the two catalog CSVs into the committed bundle. Pure and
 * validating: any structural problem throws with the offending id, so a bad
 * CSV edit fails `catalog:build` and the sync test rather than reaching the
 * database. Output order is by id / (scope, key, unit), independent of row
 * order in the CSVs.
 */
export const buildCatalogBundle = (ingredientsCsv: string, conversionsCsv: string): CatalogBundle => {
  const ingredients = toIngredients(toRows(ingredientsCsv, INGREDIENT_HEADER, 'ingredients.csv'));
  const conversions = toConversions(
    toRows(conversionsCsv, CONVERSION_HEADER, 'conversions.csv'),
    ingredients,
  );
  return { ingredients, conversions };
};

/** The exact text written to each committed JSON file. */
export const serialiseBundleFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
