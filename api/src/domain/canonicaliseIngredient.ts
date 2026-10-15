import { resolveIngredient } from './ingredientCatalog.js';
import type { CatalogEntry, CatalogIndex } from './ingredientCatalog.js';
import type { ConversionLookup } from './ingredientConversion.js';
import { canonicalizePantryUnit } from './pantryUnits.js';

/**
 * Write-side canonicalisation (Build B, B2b): turns a free-text ingredient
 * name into the catalog's canonical name plus its `ingredient_id`. Pure.
 *
 * Contract: it never fails and never loses information. A name that does not
 * resolve (or is ambiguous) is kept exactly as typed with a null id and a
 * flag; words dropped from a resolved name go to the notes; a unit is
 * converted only where the catalog defines the factor, and the original
 * amount is then recorded in the notes.
 */

/** `null` = the catalog was not consulted (unavailable); the backfill picks those rows up. */
export type CatalogMatch = 'resolved' | 'ambiguous' | 'unresolved';

export interface CanonicaliserContext {
  readonly index: CatalogIndex;
  readonly lookup: ConversionLookup;
}

export interface RecipeLineInput {
  readonly name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly notes: string | null;
}

export interface CanonicalRecipeLine extends RecipeLineInput {
  readonly ingredientId: string | null;
  readonly catalogMatch: CatalogMatch | null;
}

export interface CanonicalPantryName {
  readonly name: string;
  readonly ingredientId: string | null;
  readonly catalogMatch: CatalogMatch | null;
}

export interface IngredientCanonicaliser {
  readonly recipeLine: (line: RecipeLineInput) => CanonicalRecipeLine;
  readonly pantryItem: (name: string) => CanonicalPantryName;
  /** The id only, for matching an already-canonical name (shopping-list items). `null` when unresolved or ambiguous. */
  readonly ingredientIdFor: (name: string) => string | null;
}

const PARENTHETICAL = /[([]([^)\]]*)[)\]]/g;
const QUANTITY_DECIMALS = 3;

type Lookup =
  | { readonly status: 'resolved'; readonly entry: CatalogEntry }
  | { readonly status: 'ambiguous' | 'unresolved' };

const lookupName = (name: string, index: CatalogIndex): Lookup => {
  const result = resolveIngredient(name, index);
  if (result === null) {
    return { status: 'unresolved' };
  }
  return result.status === 'resolved' ? { status: 'resolved', entry: result.entry } : { status: 'ambiguous' };
};

const hasParenthetical = (text: string): boolean => /[([]/.test(text);

const parentheticalsOf = (text: string): string[] =>
  [...text.matchAll(PARENTHETICAL)].map((match) => (match[1] ?? '').trim()).filter((part) => part !== '');

const appendNote = (notes: string | null, addition: string): string => {
  if (notes === null || notes.trim() === '') {
    return addition;
  }
  return notes.toLowerCase().includes(addition.toLowerCase()) ? notes : `${notes}; ${addition}`;
};

/** Words in (...) that the canonical name does not carry would otherwise vanish with the rename. */
const withDroppedQualifiers = (original: string, entry: CatalogEntry, notes: string | null): string | null => {
  if (!hasParenthetical(original) || hasParenthetical(entry.canonicalName)) {
    return notes;
  }
  return parentheticalsOf(original).reduce<string | null>((acc, part) => appendNote(acc, part), notes);
};

const roundQuantity = (value: number): number => Number(value.toFixed(QUANTITY_DECIMALS));

const formatAmount = (quantity: number, unit: string): string => `${quantity} ${unit}`;

interface Measure {
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly notes: string | null;
}

/**
 * Converts only when the catalog does not allow the written unit AND defines a
 * factor to a unit it does allow; otherwise the measure is untouched. A
 * conversion records the original amount in the notes.
 */
const convertMeasure = (line: RecipeLineInput, notes: string | null, entry: CatalogEntry, context: CanonicaliserContext): Measure => {
  const unchanged: Measure = { quantity: line.quantity, unit: line.unit, notes };
  if (line.quantity === null || line.unit === null || line.unit.trim() === '') {
    return unchanged;
  }
  const unit = canonicalizePantryUnit(line.unit);
  if (entry.allowedUnits.includes(unit)) {
    return unchanged;
  }
  const factor = context.lookup.factorFor(entry.id, unit);
  if (factor === null || !entry.allowedUnits.includes(factor.baseUnit)) {
    return unchanged;
  }
  return {
    quantity: roundQuantity(line.quantity * factor.amount),
    unit: factor.baseUnit,
    notes: appendNote(notes, formatAmount(line.quantity, unit)),
  };
};

export const canonicaliseRecipeLine = (line: RecipeLineInput, context: CanonicaliserContext): CanonicalRecipeLine => {
  const found = lookupName(line.name, context.index);
  if (found.status !== 'resolved') {
    return { ...line, ingredientId: null, catalogMatch: found.status };
  }
  const notes = withDroppedQualifiers(line.name, found.entry, line.notes);
  const measure = convertMeasure(line, notes, found.entry, context);
  return {
    name: found.entry.canonicalName,
    quantity: measure.quantity,
    unit: measure.unit,
    notes: measure.notes,
    ingredientId: found.entry.id,
    catalogMatch: 'resolved',
  };
};

/**
 * Pantry rows have no notes column, so nothing may be dropped: when resolving
 * would lose a typed qualifier ("Onion (red, Nashik)") the typed name stays
 * and only the id is recorded. Quantity and unit are never touched; pantry
 * quantities are merged at read time through the catalog conversions.
 */
export const canonicalisePantryItem = (name: string, context: CanonicaliserContext): CanonicalPantryName => {
  const found = lookupName(name, context.index);
  if (found.status !== 'resolved') {
    return { name, ingredientId: null, catalogMatch: found.status };
  }
  const losesQualifier = hasParenthetical(name) && !hasParenthetical(found.entry.canonicalName);
  return {
    name: losesQualifier ? name : found.entry.canonicalName,
    ingredientId: found.entry.id,
    catalogMatch: 'resolved',
  };
};

export const createCanonicaliser = (context: CanonicaliserContext): IngredientCanonicaliser => ({
  recipeLine: (line) => canonicaliseRecipeLine(line, context),
  pantryItem: (name) => canonicalisePantryItem(name, context),
  ingredientIdFor: (name) => {
    const found = lookupName(name, context.index);
    return found.status === 'resolved' ? found.entry.id : null;
  },
});

/** Used when the catalog could not be loaded: saves proceed unchanged and unflagged. */
export const IDENTITY_CANONICALISER: IngredientCanonicaliser = {
  recipeLine: (line) => ({ ...line, ingredientId: null, catalogMatch: null }),
  pantryItem: (name) => ({ name, ingredientId: null, catalogMatch: null }),
  ingredientIdFor: () => null,
};
