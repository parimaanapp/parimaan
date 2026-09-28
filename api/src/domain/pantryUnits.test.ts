import { describe, expect, it } from 'vitest';
import { KNOWN_PANTRY_UNITS, canonicalizePantryUnit } from './pantryUnits.js';

describe('canonicalizePantryUnit', () => {
  it.each(KNOWN_PANTRY_UNITS)('passes a known unit %s through unchanged', (unit) => {
    expect(canonicalizePantryUnit(unit)).toBe(unit);
  });

  it('lowercases a known unit typed in a different case', () => {
    expect(canonicalizePantryUnit('KG')).toBe('kg');
    expect(canonicalizePantryUnit('Tbsp')).toBe('tbsp');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(canonicalizePantryUnit('  kg  ')).toBe('kg');
  });

  it('passes an unrecognised unit through as-is (trimmed), not rejected', () => {
    expect(canonicalizePantryUnit('पाव')).toBe('पाव');
    expect(canonicalizePantryUnit('  dozen  ')).toBe('dozen');
  });

  it('knows jar and bottle — W19 S2\'s real Gemini vision spike found >75% of real photo-sourced quantities used container-count units these weren\'t in yet', () => {
    expect(KNOWN_PANTRY_UNITS as readonly string[]).toContain('jar');
    expect(KNOWN_PANTRY_UNITS as readonly string[]).toContain('bottle');
  });
});
