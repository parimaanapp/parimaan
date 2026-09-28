/**
 * W20 D9 (`E2E_MVP_PLAN.md` §27.2) — one CloudWatch EMF line per analyzed
 * photo. PostHog does not exist until W24, so these server-side counts are
 * how PRD §11's photo-accuracy numbers get measured meanwhile: how many
 * items came back, how many the server dropped as junk, how many were
 * high-confidence, how often the result was empty, and how long it took.
 * Same emission shape as `costMetric.ts`'s `emitAiCostMetric`.
 */
export interface PhotoAnalysisSummary {
  itemsProposed: number;
  itemsDropped: number;
  highConfidenceItems: number;
  truncated: boolean;
  latencyMs: number;
}

export const emitPhotoAnalysisMetric = (
  summary: PhotoAnalysisSummary,
  // eslint-disable-next-line no-console -- same justified EMF-boundary exception as costMetric.ts: CloudWatch's EMF extraction reads Lambda's stdout, which only console.log writes to.
  log: (line: string) => void = console.log,
): void => {
  try {
    log(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: 'Parimaan/PhotoPantry',
              Metrics: [
                { Name: 'ItemsProposed', Unit: 'Count' },
                { Name: 'ItemsDropped', Unit: 'Count' },
                { Name: 'HighConfidenceItems', Unit: 'Count' },
                { Name: 'EmptyResult', Unit: 'Count' },
                { Name: 'Truncated', Unit: 'Count' },
                { Name: 'LatencyMs', Unit: 'Milliseconds' },
              ],
            },
          ],
        },
        ItemsProposed: summary.itemsProposed,
        ItemsDropped: summary.itemsDropped,
        HighConfidenceItems: summary.highConfidenceItems,
        EmptyResult: summary.itemsProposed === 0 ? 1 : 0,
        Truncated: summary.truncated ? 1 : 0,
        LatencyMs: summary.latencyMs,
      }),
    );
  } catch {
    // Metering must never fail a photo the user already waited for.
  }
};
