/**
 * Maps the many ways recipe text spells a unit onto the canonical spellings
 * used by `pantryUnits.ts`/`unitConversion.ts`. Returns `null` for anything
 * that is not a unit — callers must never substitute a default (a former
 * bug let a placeholder "cup" leak into unitless lines).
 */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', mls: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbspn: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  // Deliberately NOT "no"/"nos": "1 no salt added tomatoes" is not "1 piece".
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  bunch: 'bunch', bunches: 'bunch',
  pinch: 'pinch', pinches: 'pinch',
  packet: 'packet', packets: 'packet', pack: 'packet', packs: 'packet',
  jar: 'jar', jars: 'jar',
  bottle: 'bottle', bottles: 'bottle',
};

export const canonicaliseUnit = (word: string): string | null => {
  const key = word.trim().toLowerCase().replace(/\.+$/, '');
  if (key === '') {
    return null;
  }
  return Object.hasOwn(UNIT_ALIASES, key) ? (UNIT_ALIASES[key] ?? null) : null;
};

/** Units that are converted to a metric canonical unit once the quantity is known. */
const METRIC_CONVERSIONS: Readonly<Record<string, { readonly unit: string; readonly factor: number }>> = {
  lb: { unit: 'g', factor: 453.6 },
  oz: { unit: 'g', factor: 28.35 },
};

/** Applies `METRIC_CONVERSIONS` (lb/oz -> g, rounded to 2 dp); any other amount passes through unchanged. */
export const toCanonicalAmount = (quantity: number | null, unit: string | null): { quantity: number | null; unit: string | null } => {
  const conversion = unit !== null && Object.hasOwn(METRIC_CONVERSIONS, unit) ? METRIC_CONVERSIONS[unit] : undefined;
  if (conversion === undefined) {
    return { quantity, unit };
  }
  return { quantity: quantity === null ? null : Math.round(quantity * conversion.factor * 100) / 100, unit: conversion.unit };
};
