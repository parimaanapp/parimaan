import type { GeminiUsage } from './geminiClient.js';

/**
 * W19 D6 — the `$5/day` AI cost alarm deferred from W7 (§13.2.9/D8: "the
 * CloudWatch `$5/day` spend alarm... deferred to W19/W24"). Real per-token
 * pricing for `gemini-3.5-flash-lite`, confirmed via W7 D11's own real-call
 * cost modeling: $0.30/M input tokens, $2.50/M output tokens. If a future
 * model swap changes this (§13.2.2 point 6/7's own standing warning), this
 * constant is the one place to update — every caller goes through
 * `estimateGeminiCostUsd`, never its own inline math.
 */
const INPUT_COST_PER_TOKEN_USD = 0.3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN_USD = 2.5 / 1_000_000;

export const estimateGeminiCostUsd = (usage: GeminiUsage): number =>
  usage.promptTokens * INPUT_COST_PER_TOKEN_USD + usage.candidateTokens * OUTPUT_COST_PER_TOKEN_USD;

/**
 * Emits one CloudWatch Embedded Metric Format (EMF) line to stdout. Lambda's
 * own CloudWatch Logs subscription extracts this into a real CloudWatch
 * metric (`Parimaan/AI` / `EstimatedCostUsd`) automatically — no
 * `cloudwatch:PutMetricData` IAM permission needed (every Lambda already
 * writes to CloudWatch Logs), and no extra network call on the AI-response
 * critical path this codebase's own `AI_DEADLINE_MS` budget is already
 * tight against. This is the first custom metric this codebase emits;
 * every AI-calling Lambda funnels through `invokeModel.ts`, so wiring it
 * there once covers `freeformParse`, `staplesNote`, and any future AI
 * feature (W20's `analyzePantryPhoto` included) without each needing its
 * own emission call.
 *
 * `log` defaults to the real `console.log` (what Lambda's own log
 * collection actually reads) and is overridable in tests so the test suite
 * never has real EMF lines cluttering its own output.
 */
export const emitAiCostMetric = (
  costUsd: number,
  // eslint-disable-next-line no-console -- this file *is* the EMF logging boundary (same justified exception as db/redactingLogger.ts): CloudWatch's EMF extraction reads Lambda's stdout stream specifically, which only console.log (not warn/error) writes to.
  log: (line: string) => void = console.log,
): void => {
  log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'Parimaan/AI',
            Metrics: [{ Name: 'EstimatedCostUsd', Unit: 'None' }],
          },
        ],
      },
      EstimatedCostUsd: costUsd,
    }),
  );
};
