import type { z } from 'zod';
import { AiBusyError, AiTimeoutError, AiUnavailableError, AiUnparseableError } from '../errors.js';
import { emitAiCostMetric, estimateGeminiCostUsd } from './costMetric.js';
import type { GeminiClientDeps, GeminiImageInput, GeminiUsage } from './geminiClient.js';
import { callGemini, GeminiAuthError, GeminiTransportError } from './geminiClient.js';

/**
 * Set from S2's own real measurement (§13.2.7/§13.2.2), not the plan's
 * original 20,000 ms estimate: `gemini-3.5-flash-lite` measured p50 ≈ 3.7s /
 * p95 ≈ 4.2s on a representative ~4,000-char parse. 3 × p95 + two backoff
 * gaps ≈ 14.6s, rounded up with a small margin — comfortably clear of
 * AppSync's 30s resolver ceiling (§13.2.8).
 */
export const AI_DEADLINE_MS = 15_000;

/**
 * W20 S1 — the vision deadline, set from a real re-measurement (E2E_MVP_PLAN.md
 * §27.6), not carried over from the text number above. On 1024px/JPEG-q80 photos
 * at temperature 0.2 with a 2048-token output cap, all 59 real calls finished in
 * ≤ 4.1s (p50 2.9s, p95 3.9s). W19's 12–27s calls were NOT payload cost: they came
 * in consecutive runs (photos #18-20, #28-33, #35-36) and the same photos took
 * 2-3s in this run — Gemini-side slow windows. So the deadline is sized for a slow
 * window, not for the typical call: 24s = the shared non-VPC Lambda's 28s timeout
 * (`infra/stacks/nonVpcResolver.ts`) minus room for the S3 head/get/delete round
 * trips and a cold start. AppSync's hard ceiling is 30s.
 */
export const VISION_DEADLINE_MS = 24_000;

const TRANSPORT_MAX_ATTEMPTS = 3; // up to 2 retries
const TRANSPORT_FIRST_BACKOFF_MS = 500;
const TRANSPORT_SECOND_BACKOFF_MS = 1_500;

/**
 * Rejects (as a parse failure, same path as malformed JSON) any raw model
 * output longer than this before `JSON.parse` ever runs on it — a
 * defensive cap, not a case anticipated from Gemini specifically (a
 * first-party endpoint, not user-reachable input). Exists because this
 * module is the seam a future provider gets swapped behind (§13.2.2 point
 * 6): without a cap, a misbehaving or compromised provider response could
 * force a full `JSON.parse` over an arbitrarily large string — twice, once
 * per output-chain attempt — against this Lambda's 512 MB memory limit.
 * 200,000 characters is generous for a recipe draft (a real response in
 * S2's own measurement was under 1,500) while still bounding the worst case.
 */
const MAX_RAW_TEXT_LENGTH = 200_000;

const REINFORCEMENT_SUFFIX =
  '\n\nReturn valid JSON only. No prose, no markdown code fences, no explanation — just the JSON object.';

/**
 * Strips a ```json ... ``` or bare ``` ... ``` fence around the model's
 * output — the most common LLM output-format deviation (Gemini included,
 * §13.2.7) — and is accepted, not treated as a parse failure.
 */
const stripMarkdownFence = (text: string): string => {
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(text.trim());
  return fenced ? fenced[1]!.trim() : text.trim();
};

/**
 * V8's `JSON.parse` `SyntaxError` embeds a snippet of the text it was
 * parsing (e.g. `Unexpected token 'B', "Basmati Ri"... is not valid
 * JSON`) — for these AI features that text is the model's raw response,
 * which can echo real household content (pantry item names, staples
 * notes) back verbatim on a bad turn. Design intent (SYSTEM_DESIGN.md
 * §8.3, E2E_MVP_PLAN.md W21 D11) is that household content is never
 * logged, and `withErrorHandling.ts` logs this error's full `cause` chain
 * server-side — so the raw `SyntaxError` must never become that cause.
 * This sanitized stand-in carries no text from the parsed input, only the
 * fact that parsing failed.
 */
const sanitizedJsonParseError = (): Error => Object.assign(new Error('Model output was not valid JSON.'), { name: 'SyntaxError' });

/** ±20% jitter on a base backoff, per §13.2.7's "jittered backoff". */
const jitter = (baseMs: number): number => baseMs + Math.random() * baseMs * 0.2;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const remainingBudget = (deadline: number): number => deadline - Date.now();

export interface InvokeModelOptions {
  /** Overall deadline for this call, including every retry. Defaults to `AI_DEADLINE_MS`. */
  deadlineMs?: number;
  /**
   * W20 S1 (the widening W19 D2 explicitly assigned to W20): inline images sent with
   * the prompt on EVERY underlying call, reinforcement retry included — a retry that
   * dropped them would ask the model to re-answer a question it can no longer see.
   */
  images?: GeminiImageInput[];
  /** Forwarded to every underlying call; `callGemini` defaults to SD §8.6's 0.2 when omitted. */
  temperature?: number;
  /** Forwarded to every underlying call; bounds output length (W20 D2/D3), and with it vision latency. */
  maxOutputTokens?: number;
}

/** The subset of `InvokeModelOptions` that shapes each individual Gemini call (vs. the deadline, which shapes the whole chain). */
type CallOptions = Pick<InvokeModelOptions, 'images' | 'temperature' | 'maxOutputTokens'>;

/**
 * `GeminiClientDeps` plus a test-only backoff hook — kept separate from
 * `GeminiClientDeps` itself since `sleepImpl` is a retry-orchestration
 * concern of this module, not something `geminiClient.ts` (one HTTP call,
 * no retries) has any use for. Defaults to a real `setTimeout`-based sleep;
 * tests inject a no-op so the real ~500ms/~1.5s backoff windows this
 * function deliberately waits out in production don't slow the suite down.
 */
export interface InvokeModelDeps extends GeminiClientDeps {
  sleepImpl?: (ms: number) => Promise<void>;
  /** W19 D6: defaults to the real `emitAiCostMetric`. Overridable in tests so the suite never emits real EMF lines. */
  emitCostMetric?: (costUsd: number) => void;
}

/**
 * The provider-neutral, Zod-validated seam every AI resolver calls —
 * `invokeModel` knows nothing about *recipes*: no field names, no enum
 * values, no bounds beyond what the caller's own schema encodes. It is
 * **not** fully provider-blind at the type level today — it imports and
 * pattern-matches on `GeminiAuthError`/`GeminiTransportError` from
 * `geminiClient.ts` directly, a pragmatic single-provider-week choice, not
 * an injected-provider-interface design. A real future provider swap
 * (W15/17/18/19, §13.2.2 point 6) means editing this file's error-mapping
 * branch, not just swapping `geminiClient.ts` out from under it untouched
 * — worth knowing going in, not discovered at swap time.
 *
 * Implements §13.2.7's contract in full: one shared deadline gates every
 * attempt (a slow attempt that would leave insufficient budget for another
 * never starts one — it throws `AiTimeoutError` instead); two independent,
 * separately-bounded retry chains (transport: up to 2 retries against
 * 429/503/500/network failure, jittered backoff; output: exactly 1
 * reinforcement retry against a JSON.parse failure or a schema validation
 * failure); the six-code error taxonomy via the typed `Ai*Error` classes in
 * `errors.ts`.
 *
 * **Enum leniency (D4/§13.2.5) is deliberately NOT this function's job.**
 * `schema.safeParse` either succeeds or it doesn't — this function cannot
 * know which of an arbitrary caller's schema fields are "closed enums to
 * degrade gracefully on" versus "structural fields that must fail hard",
 * since it is generic over `z.ZodSchema<T>` and knows nothing about the
 * shape it validates. That distinction belongs entirely in how the
 * *caller* builds its schema — e.g. `cuisineTier1: someEnumSchema.catch
 * (null)` lets one field fall back without failing the whole parse, while
 * every other field still fails hard on a genuine structural/bounds
 * violation. `RecipeDraft`'s own schema (S3) is where D4's rule actually
 * gets implemented; this function only ever sees "parsed successfully" or
 * "didn't."
 *
 * The rate limit is deliberately not touched here either — the caller
 * checks it once, before calling `invokeModel` at all. Every retry this
 * function performs happens *inside* that single outer call, so the "rate
 * limit consumed exactly once per user call regardless of internal
 * retries" property (§13.2.7/§13.2.9) falls out of that call shape for
 * free, rather than needing special-cased bookkeeping in here.
 */
export const invokeModel = async <T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  options: InvokeModelOptions = {},
  deps: InvokeModelDeps = {},
): Promise<T> => {
  const deadline = Date.now() + (options.deadlineMs ?? AI_DEADLINE_MS);
  const callOptions: CallOptions = {
    ...(options.images !== undefined ? { images: options.images } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  };
  const firstRawText = await callWithTransportRetries(prompt, deadline, deps, callOptions);
  return parseWithReinforcementRetry(prompt, firstRawText, schema, deadline, deps, callOptions);
};

/**
 * W19 D6: every real Gemini call this function makes (including a
 * reinforcement retry — a real second call incurs real second cost) emits a
 * cost-metric line, never gated on the caller's own success/failure path.
 * Wrapped so a metering bug can never turn a real, otherwise-successful AI
 * response into a thrown error — see `costMetric.ts`'s own doc comment.
 */
const emitCostMetricSafely = (usage: GeminiUsage, deps: InvokeModelDeps): void => {
  try {
    (deps.emitCostMetric ?? ((costUsd) => emitAiCostMetric(costUsd)))(estimateGeminiCostUsd(usage));
  } catch {
    // Metering must never break the real response.
  }
};

/** The transport chain: retries a Gemini call against transient failures, deadline-gated throughout. */
const callWithTransportRetries = async (
  prompt: string,
  deadline: number,
  deps: InvokeModelDeps,
  callOptions: CallOptions,
): Promise<string> => {
  for (let attempt = 1; attempt <= TRANSPORT_MAX_ATTEMPTS; attempt++) {
    const budget = remainingBudget(deadline);
    if (budget <= 0) {
      throw new AiTimeoutError();
    }
    try {
      const result = await callGemini(prompt, { timeoutMs: budget, ...callOptions }, deps);
      emitCostMetricSafely(result.usage, deps);
      return result.rawText;
    } catch (error) {
      if (error instanceof GeminiAuthError) {
        throw new AiUnavailableError(undefined, { cause: error });
      }
      if (!(error instanceof GeminiTransportError)) {
        // An unexpected, non-typed failure (e.g. a response shape Gemini
        // changes on us again, §13.2.2's own lesson from today) is not
        // transport-retryable — surface it as unavailable rather than
        // looping the transport chain against a request that will fail
        // identically every time. `cause` is what makes this
        // distinguishable in CloudWatch from a genuine auth failure or a
        // real outage — see `errors.ts`'s own doc on why this matters.
        throw new AiUnavailableError(undefined, { cause: error });
      }
      if (attempt === TRANSPORT_MAX_ATTEMPTS) {
        throw new AiBusyError(undefined, { cause: error });
      }
      const backoff = jitter(attempt === 1 ? TRANSPORT_FIRST_BACKOFF_MS : TRANSPORT_SECOND_BACKOFF_MS);
      if (remainingBudget(deadline) <= backoff) {
        throw new AiTimeoutError();
      }
      await (deps.sleepImpl ?? realSleep)(backoff);
    }
  }
  // Unreachable — the loop always returns or throws — but TypeScript can't
  // prove that from a `for` bound by a named constant.
  throw new AiBusyError();
};

/** The output chain: parses (stripping any markdown fence) and validates, with exactly one reinforcement retry. */
const parseWithReinforcementRetry = async <T>(
  originalPrompt: string,
  firstRawText: string,
  schema: z.ZodSchema<T>,
  deadline: number,
  deps: InvokeModelDeps,
  callOptions: CallOptions,
): Promise<T> => {
  const tryParse = (rawText: string): { ok: true; value: T } | { ok: false; reason: unknown } => {
    if (rawText.length > MAX_RAW_TEXT_LENGTH) {
      return { ok: false, reason: new Error(`Raw model output exceeded ${MAX_RAW_TEXT_LENGTH} characters (${rawText.length}).`) };
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripMarkdownFence(rawText));
    } catch {
      return { ok: false, reason: sanitizedJsonParseError() };
    }
    const result = schema.safeParse(parsedJson);
    return result.success ? { ok: true, value: result.data } : { ok: false, reason: result.error };
  };

  const first = tryParse(firstRawText);
  if (first.ok) {
    return first.value;
  }

  if (remainingBudget(deadline) <= 0) {
    throw new AiTimeoutError();
  }

  const reinforcedPrompt = originalPrompt + REINFORCEMENT_SUFFIX;
  const secondRawText = await callWithTransportRetries(reinforcedPrompt, deadline, deps, callOptions);
  const second = tryParse(secondRawText);
  if (second.ok) {
    return second.value;
  }
  throw new AiUnparseableError(undefined, { cause: second.reason });
};
