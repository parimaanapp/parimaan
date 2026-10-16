import { FILLER_WORDS, normaliseKey, resolveIngredient } from './ingredientCatalog.js';
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
const UNBALANCED_TAIL = /[([]([^)\]]*)$/;
const QUANTITY_DECIMALS = 3;

type Lookup =
  | { readonly status: 'resolved'; readonly entry: CatalogEntry }
  | { readonly status: 'ambiguous' | 'unresolved' };

const classify = (name: string, index: CatalogIndex): Lookup | null => {
  const result = resolveIngredient(name, index);
  if (result === null) {
    return null;
  }
  return result.status === 'resolved' ? { status: 'resolved', entry: result.entry } : { status: 'ambiguous' };
};

const LAST_GROUP = /\s*([([][^()[\]]*[)\]]|[([][^)\]]*)\s*$/;
const MAX_STRIPS = 3;

/**
 * Resolves the typed name; when that fails, drops trailing bracketed parts one
 * at a time ("Ragi (Finger Millet, Whole) (sprouted)" -> "Ragi (Finger Millet,
 * Whole)"). The dropped text is recovered by `lostText`, never discarded.
 */
const lookupName = (name: string, index: CatalogIndex): Lookup => {
  let candidate = name;
  for (let strip = 0; strip <= MAX_STRIPS; strip += 1) {
    const found = classify(candidate, index);
    if (found !== null) {
      return found;
    }
    const shorter = candidate.replace(LAST_GROUP, '');
    if (shorter === candidate || shorter.trim() === '') {
      break;
    }
    candidate = shorter;
  }
  return { status: 'unresolved' };
};

/** Every bracketed part of a typed name, including the text after an unbalanced opening bracket. */
const parentheticalsOf = (text: string): string[] => {
  const balanced = [...text.matchAll(PARENTHETICAL)].map((match) => (match[1] ?? '').trim());
  const tail = (text.replace(PARENTHETICAL, ' ').match(UNBALANCED_TAIL)?.[1] ?? '').trim();
  return [...balanced, tail].filter((part) => part !== '');
};

const tokensOf = (text: string): string[] => normaliseKey(text, { keepParentheticals: true }).split(' ').filter(Boolean);

/** A typed part is kept by the canonical name when all its words already appear in it. */
const carriedBy = (part: string, entry: CatalogEntry): boolean => {
  const canonical = new Set(tokensOf(entry.canonicalName));
  return tokensOf(part).every((token) => canonical.has(token));
};

/** Filler words (fresh, small, ...) the resolver ignores, when the canonical name does not itself contain them. */
const droppedFillers = (original: string, entry: CatalogEntry): string[] => {
  const canonical = new Set(tokensOf(entry.canonicalName));
  return normaliseKey(original)
    .split(' ')
    .filter((token) => FILLER_WORDS.has(token) && !canonical.has(token));
};

/** Everything the typed name said that the canonical name does not: bracketed qualifiers, then filler words. */
const lostText = (original: string, entry: CatalogEntry): string[] => [
  ...parentheticalsOf(original).filter((part) => !carriedBy(part, entry)),
  ...droppedFillers(original, entry),
];

const appendNote = (notes: string | null, addition: string): string => {
  if (notes === null || notes.trim() === '') {
    return addition;
  }
  const segments = notes.split(';').map((segment) => segment.trim().toLowerCase());
  return segments.includes(addition.trim().toLowerCase()) ? notes : `${notes}; ${addition}`;
};

const withLostText = (original: string, entry: CatalogEntry, notes: string | null): string | null =>
  lostText(original, entry).reduce<string | null>((acc, part) => appendNote(acc, part), notes);

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
  const notes = withLostText(line.name, found.entry, line.notes);
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
  const losesQualifier = lostText(name, found.entry).length > 0;
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
