import { suggestNames, type CatalogIngredient, type IngredientCatalog } from './recipeCatalog.js';

/**
 * B3-0 catalog lint for curated recipe seeds. Pure functions over an
 * `IngredientCatalog`; `validateCuratedRecipes.ts` wires them in.
 */
export interface LintIngredient {
  readonly name: string;
  readonly quantity?: number | null;
  readonly unit?: string | null;
  readonly category?: string | null;
  readonly isStaple?: boolean | null;
}

export interface CatalogLintResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Ingredients a recipe genuinely needs that the signed-off catalog does not
 * list yet. Reported (as `catalog gap` warnings) rather than failed so the
 * lint stays green; the catalog is NOT extended here. Remove an entry once
 * the catalog gains the ingredient.
 */
export const KNOWN_CATALOG_GAPS: ReadonlySet<string> = new Set(['Boondi', 'Kudampuli (Gambooge)']);

/** Salt and every pepper are "to taste" staples (decisions.md). */
const ALWAYS_STAPLE: ReadonlySet<string> = new Set([
  'Salt',
  'Black Pepper (Whole)',
  'Black Pepper Powder',
  'White Pepper Powder',
  'White Pepper (Whole)',
]);

const HTML_ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i;

const UNIT_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['tablespoons?|tbsps?|tbs', 'tbsp'],
  ['teaspoons?|tsps?', 'tsp'],
  ['cups?', 'cup'],
  ['kilograms?|kgs?', 'kg'],
  ['grams?|gms?|g', 'g'],
  ['millilit(?:re|er)s?|mls?', 'ml'],
  ['lit(?:re|er)s?|l', 'l'],
  ['bunch(?:es)?', 'bunch'],
  ['pieces?', 'piece'],
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeUnit(unit: string): string {
  const lower = unit.trim().toLowerCase();
  for (const [pattern, canonical] of UNIT_WORDS) {
    if (new RegExp(`^(?:${pattern})$`).test(lower)) {
      return canonical;
    }
  }
  return lower;
}

function stepTerms(ingredient: CatalogIngredient | undefined, name: string): string[] {
  const lower = name.toLowerCase();
  const withoutParens = lower.replace(/\s*\([^)]*\)/g, '').trim();
  return [...new Set([lower, withoutParens, ...(ingredient?.aliases.map((a) => a.toLowerCase()) ?? [])])]
    .filter((term) => term.length >= 3)
    .sort((a, b) => b.length - a.length);
}

function lintStepQuantities(
  ingredients: readonly LintIngredient[],
  steps: readonly string[],
  catalog: IngredientCatalog,
): string[] {
  const unitPattern = UNIT_WORDS.map(([pattern]) => pattern).join('|');
  const warnings: string[] = [];
  for (const ingredient of ingredients) {
    if (!ingredient.unit || ingredient.quantity == null) {
      continue;
    }
    const listed = normalizeUnit(ingredient.unit);
    const terms = stepTerms(catalog.byCanonical.get(ingredient.name), ingredient.name);
    const termPattern = terms.map(escapeRegex).join('|');
    if (termPattern.length === 0) {
      continue;
    }
    const mention = new RegExp(
      `(?<![\\w.])(\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?)\\s*(${unitPattern})\\b\\s+(?:of\\s+)?(?:[a-z-]+\\s+){0,2}?(?:${termPattern})(?![a-z])`,
      'gi',
    );
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      for (const match of step.matchAll(mention)) {
        const stated = normalizeUnit(match[2] ?? '');
        const key = `${index}:${stated}`;
        if (stated !== listed && !seen.has(key)) {
          seen.add(key);
          warnings.push(
            `steps[${index}]: states "${match[1]} ${match[2]}" for ${ingredient.name} but the ingredient list uses ${ingredient.quantity} ${ingredient.unit}`,
          );
        }
      }
    });
  }
  return warnings;
}

function lintIngredient(ingredient: LintIngredient, index: number, catalog: IngredientCatalog): CatalogLintResult {
  const at = `ingredients.${index}`;
  const exact = catalog.byCanonical.get(ingredient.name);
  if (!exact) {
    if (KNOWN_CATALOG_GAPS.has(ingredient.name)) {
      return { errors: [], warnings: [`${at}.name: catalog gap — "${ingredient.name}" is not in the catalog yet`] };
    }
    const lower = ingredient.name.toLowerCase();
    const sameName = [...catalog.byCanonical.values()].filter((item) => item.canonicalName.toLowerCase() === lower);
    const matches = sameName.length > 0 ? sameName : (catalog.byAlias.get(lower) ?? []);
    if (matches.length === 1) {
      return { errors: [`${at}.name: "${ingredient.name}" is not canonical — use "${matches[0]?.canonicalName}"`], warnings: [] };
    }
    if (matches.length > 1) {
      const options = matches.map((item) => `"${item.canonicalName}"`).join(' or ');
      return { errors: [`${at}.name: "${ingredient.name}" is ambiguous — use ${options}`], warnings: [] };
    }
    const suggestions = suggestNames(catalog, ingredient.name)
      .map((s) => `"${s}"`)
      .join(', ');
    return { errors: [`${at}.name: unknown ingredient "${ingredient.name}" — closest: ${suggestions}`], warnings: [] };
  }

  const errors: string[] = [];
  const hasQuantity = ingredient.quantity !== null && ingredient.quantity !== undefined;
  const mustBeStaple = ALWAYS_STAPLE.has(ingredient.name);
  if (mustBeStaple && ingredient.isStaple !== true) {
    errors.push(`${at}.isStaple: "${ingredient.name}" must be isStaple: true`);
  }
  if (!hasQuantity) {
    if (!(mustBeStaple && ingredient.isStaple === true)) {
      errors.push(`${at}.quantity: required (absent only for a staple Salt or pepper)`);
    }
  } else if (!((ingredient.quantity as number) > 0)) {
    errors.push(`${at}.quantity: must be a positive number (got ${ingredient.quantity})`);
  }
  const unit = ingredient.unit?.trim();
  if (hasQuantity && !unit) {
    errors.push(`${at}.unit: required when a quantity is given`);
  }
  if (unit && !exact.allowedUnits.includes(unit)) {
    errors.push(
      `${at}.unit: unit "${unit}" is not allowed for ${exact.canonicalName} (allowed: ${exact.allowedUnits.join(', ')})`,
    );
  }
  const category = ingredient.category?.trim();
  if (category && category !== exact.appCategory) {
    errors.push(
      `${at}.category: category "${category}" must be "${exact.appCategory}" for ${exact.canonicalName} (or omitted)`,
    );
  }
  return { errors, warnings: [] };
}

export interface CatalogLintInput {
  readonly ingredients: readonly LintIngredient[];
  readonly steps: readonly string[];
  /** Free-text fields scanned for HTML entities, as `[path, value]`. */
  readonly texts: ReadonlyArray<readonly [string, string | null | undefined]>;
}

export function lintAgainstCatalog(input: CatalogLintInput, catalog: IngredientCatalog): CatalogLintResult {
  const perIngredient = input.ingredients.map((ingredient, index) => lintIngredient(ingredient, index, catalog));
  const errors = perIngredient.flatMap((result) => result.errors);
  const warnings = perIngredient.flatMap((result) => result.warnings);

  for (const [path, value] of input.texts) {
    if (value && HTML_ENTITY.test(value)) {
      errors.push(`${path}: contains an HTML entity (write the plain character)`);
    }
  }
  return { errors, warnings: [...warnings, ...lintStepQuantities(input.ingredients, input.steps, catalog)] };
}
