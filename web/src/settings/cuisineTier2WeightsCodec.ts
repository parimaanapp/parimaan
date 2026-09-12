import { CUISINE_BIAS_OPTIONS, type CuisineBias } from './domain';
import type { CuisineTier2WeightsMap } from './types';

const isBias = (value: unknown): value is CuisineBias =>
  typeof value === 'string' && (CUISINE_BIAS_OPTIONS as readonly string[]).includes(value);

/** See `mealStructureCodec.ts`'s identical reasoning — tolerant decode, canonical-order encode. */
export const decodeCuisineTier2Weights = (wireValue: string): CuisineTier2WeightsMap => {
  try {
    const parsed = JSON.parse(wireValue) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(([, value]) => isBias(value));
    return Object.fromEntries(entries) as CuisineTier2WeightsMap;
  } catch {
    return {};
  }
};

/** Sorted by key so two maps with the same entries always encode to the same string. */
export const encodeCuisineTier2Weights = (map: CuisineTier2WeightsMap): string => {
  const ordered = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(ordered);
};
