/**
 * W21 D13 — one CloudWatch EMF line per `cookFromPantry` call. PostHog does not
 * exist until W24, so these server-side counts are how suggestion quality is
 * measured meanwhile: how often the cache answered, how each call ended, how
 * many of the model's suggestions the household's rules and the pantry
 * dropped, how grounded the survivors were, and how long it took. Counts and
 * ratios only: never a pantry name, a title or an ingredient (D11). Same
 * emission shape as `photoMetric.ts`.
 */
/** What a call that returned an answer found (the GraphQL `CookFromPantryOutcome`). */
export type CookResultOutcome = 'suggestions' | 'pantry_too_small' | 'no_grounded_suggestions';

/** As a metric, a call may also have `failed` (rate limited, timed out, model error, rejected): failure rate and latency are what a 26s budget most needs measured. */
export type CookOutcome = CookResultOutcome | 'failed';

export interface CookSummary {
  cacheHit: boolean;
  outcome: CookOutcome;
  suggestionsReturned: number;
  droppedSkip: number;
  droppedDietary: number;
  droppedUngrounded: number;
  meanHaveRatio: number;
  latencyMs: number;
}

export const emitCookMetric = (
  summary: CookSummary,
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
              Namespace: 'Parimaan/CookFromPantry',
              Metrics: [
                { Name: 'CacheHit', Unit: 'Count' },
                { Name: 'PantryTooSmall', Unit: 'Count' },
                { Name: 'NoGroundedSuggestions', Unit: 'Count' },
                { Name: 'Failed', Unit: 'Count' },
                { Name: 'SuggestionsReturned', Unit: 'Count' },
                { Name: 'DroppedSkip', Unit: 'Count' },
                { Name: 'DroppedDietary', Unit: 'Count' },
                { Name: 'DroppedUngrounded', Unit: 'Count' },
                { Name: 'MeanHaveRatio', Unit: 'None' },
                { Name: 'LatencyMs', Unit: 'Milliseconds' },
              ],
            },
          ],
        },
        CacheHit: summary.cacheHit ? 1 : 0,
        PantryTooSmall: summary.outcome === 'pantry_too_small' ? 1 : 0,
        NoGroundedSuggestions: summary.outcome === 'no_grounded_suggestions' ? 1 : 0,
        Failed: summary.outcome === 'failed' ? 1 : 0,
        SuggestionsReturned: summary.suggestionsReturned,
        DroppedSkip: summary.droppedSkip,
        DroppedDietary: summary.droppedDietary,
        DroppedUngrounded: summary.droppedUngrounded,
        MeanHaveRatio: summary.meanHaveRatio,
        LatencyMs: summary.latencyMs,
      }),
    );
  } catch {
    // Metering must never fail a request the user already waited for.
  }
};
