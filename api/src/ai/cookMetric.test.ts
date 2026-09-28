import { describe, expect, it } from 'vitest';
import { emitCookMetric, type CookSummary } from './cookMetric.js';

const summary: CookSummary = {
  cacheHit: false,
  outcome: 'suggestions',
  suggestionsReturned: 3,
  droppedSkip: 1,
  droppedDietary: 0,
  droppedUngrounded: 2,
  meanHaveRatio: 0.9,
  latencyMs: 5200,
};

describe('emitCookMetric (D13)', () => {
  it('writes one EMF line in the Parimaan/CookFromPantry namespace', () => {
    const lines: string[] = [];
    emitCookMetric(summary, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as { _aws: { CloudWatchMetrics: { Namespace: string }[] } };
    expect(parsed._aws.CloudWatchMetrics[0]?.Namespace).toBe('Parimaan/CookFromPantry');
  });

  it('carries counts and ratios only — never a name, a title or an ingredient', () => {
    const lines: string[] = [];
    emitCookMetric(summary, (line) => lines.push(line));
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['CacheHit']).toBe(0);
    expect(parsed['SuggestionsReturned']).toBe(3);
    expect(parsed['DroppedSkip']).toBe(1);
    expect(parsed['DroppedUngrounded']).toBe(2);
    expect(parsed['MeanHaveRatio']).toBe(0.9);
    expect(parsed['LatencyMs']).toBe(5200);
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string') {
        throw new Error(`unexpected string field: ${value}`);
      }
    }
  });

  it('records the outcome as a 0/1 flag per outcome', () => {
    const lines: string[] = [];
    emitCookMetric({ ...summary, outcome: 'pantry_too_small', suggestionsReturned: 0 }, (line) => lines.push(line));
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['PantryTooSmall']).toBe(1);
    expect(parsed['NoGroundedSuggestions']).toBe(0);
  });

  it('records a failed call (rate limited, timed out, model error) as Failed=1 with no other outcome flag', () => {
    const lines: string[] = [];
    emitCookMetric({ ...summary, outcome: 'failed', suggestionsReturned: 0 }, (line) => lines.push(line));
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['Failed']).toBe(1);
    expect(parsed['PantryTooSmall']).toBe(0);
    expect(parsed['NoGroundedSuggestions']).toBe(0);
  });

  it('never throws, whatever the log function does (metering must not fail a request the user waited for)', () => {
    expect(() =>
      emitCookMetric(summary, () => {
        throw new Error('stdout closed');
      }),
    ).not.toThrow();
  });
});
