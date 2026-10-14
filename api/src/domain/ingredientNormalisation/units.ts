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
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', no: 'piece', nos: 'piece',
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
