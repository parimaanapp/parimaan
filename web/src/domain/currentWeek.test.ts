import { describe, expect, it } from 'vitest';
import { currentWeekStartDate, currentWeekStartDateIso, utcMidnight } from './currentWeek';

describe('utcMidnight', () => {
  it('discards time-of-day and timezone, keeping only the calendar date', () => {
    const result = utcMidnight(new Date('2026-09-10T23:45:00+05:30'));
    expect(result.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });
});

describe('currentWeekStartDate', () => {
  it('returns the same Monday when today is already Monday', () => {
    const monday = new Date('2026-09-07T10:00:00.000Z');
    expect(currentWeekStartDate(monday).toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('returns the prior Monday when today is mid-week', () => {
    const wednesday = new Date('2026-09-09T10:00:00.000Z');
    expect(currentWeekStartDate(wednesday).toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('returns the prior Monday when today is Sunday (the week-end)', () => {
    const sunday = new Date('2026-09-13T10:00:00.000Z');
    expect(currentWeekStartDate(sunday).toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });
});

describe('currentWeekStartDateIso', () => {
  it('returns an ISO string matching currentWeekStartDate', () => {
    const wednesday = new Date('2026-09-09T10:00:00.000Z');
    expect(currentWeekStartDateIso(wednesday)).toBe(currentWeekStartDate(wednesday).toISOString());
  });
});
