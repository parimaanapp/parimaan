import { describe, expect, it } from 'vitest';
import { emitPhotoAnalysisMetric } from './photoMetric.js';

describe('emitPhotoAnalysisMetric (W20 D9 — server-side counts stand in for PostHog until W24)', () => {
  it('emits one CloudWatch EMF line with the counts the acceptance measurement needs', () => {
    const lines: string[] = [];
    emitPhotoAnalysisMetric({ itemsProposed: 5, itemsDropped: 2, highConfidenceItems: 3, truncated: false, latencyMs: 2900 }, (l) => lines.push(l));

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown> & { _aws: { CloudWatchMetrics: Array<{ Namespace: string; Metrics: Array<{ Name: string }> }> } };
    expect(parsed._aws.CloudWatchMetrics[0]!.Namespace).toBe('Parimaan/PhotoPantry');
    expect(parsed._aws.CloudWatchMetrics[0]!.Metrics.map((m) => m.Name).sort()).toEqual(
      ['EmptyResult', 'HighConfidenceItems', 'ItemsDropped', 'ItemsProposed', 'LatencyMs', 'Truncated'],
    );
    expect(parsed).toMatchObject({ ItemsProposed: 5, ItemsDropped: 2, HighConfidenceItems: 3, EmptyResult: 0, Truncated: 0, LatencyMs: 2900 });
  });

  it('flags an empty result — W19 saw ~10% of real photos come back empty, and that rate is worth alarming on later', () => {
    const lines: string[] = [];
    emitPhotoAnalysisMetric({ itemsProposed: 0, itemsDropped: 0, highConfidenceItems: 0, truncated: false, latencyMs: 1 }, (l) => lines.push(l));
    expect(JSON.parse(lines[0]!)).toMatchObject({ EmptyResult: 1 });
  });

  it('never throws — a metering failure must not fail a photo the user already waited for', () => {
    expect(() =>
      emitPhotoAnalysisMetric({ itemsProposed: 1, itemsDropped: 0, highConfidenceItems: 0, truncated: false, latencyMs: 1 }, () => {
        throw new Error('log sink down');
      }),
    ).not.toThrow();
  });
});
