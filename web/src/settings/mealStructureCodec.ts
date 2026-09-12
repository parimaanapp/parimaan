import { MEAL_TYPES, type MealType } from './domain';
import type { MealStructureEntry, MealStructureMap } from './types';

export const DEFAULT_MEAL_STRUCTURE_ENTRY: MealStructureEntry = { carb: 1, sabzi_dal: 1, accompaniment: 0 };

/**
 * Decodes the `mealStructure` `AWSJSON` wire string into a typed map.
 * Tolerant of an empty/malformed string (a brand-new household's settings
 * row may not have every meal type populated yet) — falls back to `{}`
 * rather than throwing, since this is read-only-decoded display data, not
 * itself validated input (the server validates whatever gets re-encoded and
 * sent back in a patch).
 */
export const decodeMealStructure = (wireValue: string): MealStructureMap => {
  try {
    const parsed = JSON.parse(wireValue) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as MealStructureMap) : {};
  } catch {
    return {};
  }
};

/** Encodes back to the canonical wire string, always in `MEAL_TYPES` order so equal maps always produce equal strings. */
export const encodeMealStructure = (map: MealStructureMap): string => {
  const ordered: MealStructureMap = {};
  for (const mealType of MEAL_TYPES) {
    const entry = map[mealType];
    if (entry) {
      ordered[mealType] = entry;
    }
  }
  return JSON.stringify(ordered);
};

export const entryFor = (map: MealStructureMap, mealType: MealType): MealStructureEntry =>
  map[mealType] ?? DEFAULT_MEAL_STRUCTURE_ENTRY;
