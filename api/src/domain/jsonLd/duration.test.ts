import { describe, expect, it } from 'vitest';
import { parseIsoDurationToMinutes } from './duration.js';

describe('parseIsoDurationToMinutes', () => {
  it('converts hours and minutes', () => {
    expect(parseIsoDurationToMinutes('PT1H30M')).toBe(90);
  });

  it('converts minutes only', () => {
    expect(parseIsoDurationToMinutes('PT45M')).toBe(45);
  });

  it('converts hours only', () => {
    expect(parseIsoDurationToMinutes('PT2H')).toBe(120);
  });

  it('rounds a fractional-seconds component', () => {
    expect(parseIsoDurationToMinutes('PT90S')).toBe(2);
  });

  it('returns null for a non-string value', () => {
    expect(parseIsoDurationToMinutes(90)).toBeNull();
    expect(parseIsoDurationToMinutes(undefined)).toBeNull();
    expect(parseIsoDurationToMinutes(null)).toBeNull();
  });

  it('returns null for an empty or bare "PT" string', () => {
    expect(parseIsoDurationToMinutes('')).toBeNull();
    expect(parseIsoDurationToMinutes('PT')).toBeNull();
  });

  it('returns null for a malformed negative duration (real S1 kannammacooks garbage value)', () => {
    expect(parseIsoDurationToMinutes('PT-496636H14M2S')).toBeNull();
  });

  it('returns null for a day/month/year duration, out of scope for a recipe time', () => {
    expect(parseIsoDurationToMinutes('P3D')).toBeNull();
  });

  it('returns null for an adversarial digit run that would otherwise overflow to Infinity', () => {
    expect(parseIsoDurationToMinutes(`PT${'9'.repeat(400)}H`)).toBeNull();
  });

  it('returns null for a well-formed but implausibly long duration', () => {
    expect(parseIsoDurationToMinutes('PT999999H')).toBeNull();
  });
});
