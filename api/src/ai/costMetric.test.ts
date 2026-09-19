import { describe, expect, it, vi } from 'vitest';
import { emitAiCostMetric, estimateGeminiCostUsd } from './costMetric.js';

describe('estimateGeminiCostUsd', () => {
  it('computes cost from real published per-token pricing ($0.30/M in, $2.50/M out)', () => {
    // The real numbers from W19 S1's own two live pantry-photo calls:
    // ~1,152 prompt tokens, ~52-185 candidate tokens.
    const costUsd = estimateGeminiCostUsd({ promptTokens: 1152, candidateTokens: 52 });

    expect(costUsd).toBeCloseTo(1152 * (0.3 / 1_000_000) + 52 * (2.5 / 1_000_000), 10);
  });

  it('returns 0 for a zero-usage call (the metering-gap fallback)', () => {
    expect(estimateGeminiCostUsd({ promptTokens: 0, candidateTokens: 0 })).toBe(0);
  });

  it('weights output tokens more heavily than input tokens, matching the real per-token price ratio', () => {
    const inputHeavy = estimateGeminiCostUsd({ promptTokens: 1000, candidateTokens: 0 });
    const outputHeavy = estimateGeminiCostUsd({ promptTokens: 0, candidateTokens: 1000 });

    expect(outputHeavy).toBeGreaterThan(inputHeavy);
  });
});

describe('emitAiCostMetric', () => {
  it('emits one valid CloudWatch Embedded Metric Format (EMF) line', () => {
    const log = vi.fn();

    emitAiCostMetric(0.00048, log);

    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0]![0] as string) as {
      _aws: { CloudWatchMetrics: [{ Namespace: string; Metrics: [{ Name: string; Unit: string }] }] };
      EstimatedCostUsd: number;
    };
    expect(line._aws.CloudWatchMetrics[0].Namespace).toBe('Parimaan/AI');
    expect(line._aws.CloudWatchMetrics[0].Metrics[0]).toEqual({ Name: 'EstimatedCostUsd', Unit: 'None' });
    expect(line.EstimatedCostUsd).toBe(0.00048);
  });

  it('defaults to console.log when no log function is given', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    emitAiCostMetric(0.001);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
