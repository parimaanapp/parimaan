import type { z } from 'zod';
import { AiBusyError, AiTimeoutError, AiUnavailableError, AiUnparseableError } from '../errors.js';
import type { GeminiClientDeps } from './geminiClient.js';
import { callGemini, GeminiAuthError, GeminiTransportError } from './geminiClient.js';

/**
 * Set from S2's own real measurement (§13.2.7/§13.2.2), not the plan's
 * original 20,000 ms estimate: `gemini-3.5-flash-lite` measured p50 ≈ 3.7s /
 * p95 ≈ 4.2s on a representative ~4,000-char parse. 3 × p95 + two backoff
 * gaps ≈ 14.6s, rounded up with a small margin — comfortably clear of
 * AppSync's 30s resolver ceiling (§13.2.8).
 */
export const AI_DEADLINE_MS = 15_000;

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

/** ±20% jitter on a base backoff, per §13.2.7's "jittered backoff". */
const jitter = (baseMs: number): number => baseMs + Math.random() * baseMs * 0.2;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const remainingBudget = (deadline: number): number => deadline - Date.now();

export interface InvokeModelOptions {
  /** Overall deadline for this call, including every retry. Defaults to `AI_DEADLINE_MS`. */
  deadlineMs?: number;
}

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
  const firstRawText = await callWithTransportRetries(prompt, deadline, deps);
  return parseWithReinforcementRetry(prompt, firstRawText, schema, deadline, deps);
};

/** The transport chain: retries a Gemini call against transient failures, deadline-gated throughout. */
const callWithTransportRetries = async (prompt: string, deadline: number, deps: InvokeModelDeps): Promise<string> => {
  for (let attempt = 1; attempt <= TRANSPORT_MAX_ATTEMPTS; attempt++) {
    const budget = remainingBudget(deadline);
    if (budget <= 0) {
      throw new AiTimeoutError();
    }
    try {
      const result = await callGemini(prompt, { timeoutMs: budget }, deps);
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
): Promise<T> => {
  const tryParse = (rawText: string): { ok: true; value: T } | { ok: false; reason: unknown } => {
    if (rawText.length > MAX_RAW_TEXT_LENGTH) {
      return { ok: false, reason: new Error(`Raw model output exceeded ${MAX_RAW_TEXT_LENGTH} characters (${rawText.length}).`) };
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripMarkdownFence(rawText));
    } catch (error) {
      return { ok: false, reason: error };
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
  const secondRawText = await callWithTransportRetries(reinforcedPrompt, deadline, deps);
  const second = tryParse(secondRawText);
  if (second.ok) {
    return second.value;
  }
  throw new AiUnparseableError(undefined, { cause: second.reason });
};
