import { writeFileSync } from 'node:fs';
import {
  buildCookFromPantryPrompt,
  COOK_MAX_OUTPUT_TOKENS,
  COOK_TEMPERATURE,
  COOK_VIBE_VALUES,
  type CookVibe,
  PROMPT_LIMITS,
  PROMPT_VERSION,
} from '../prompts/cookFromPantry.js';
import { callGemini, GEMINI_MODEL } from '../src/ai/geminiClient.js';
import { type GeminiCookSuggestions, geminiCookSuggestionsSchema } from '../src/ai/schemas/cookSuggestions.js';
import { namesMatch, normalizeIngredientName } from '../src/domain/shoppingListGeneration.js';
import { COOK_SPIKE_FIXTURES, type CookSpikeFixture } from './cookFromPantryFixtures.js';

/**
 * W21 S1 (D12) — the real-call measurement spike. Not a resolver, not
 * rate-limited, not retried: it sends the real prompt builder's output and
 * validates with the real schema, so it measures what a first attempt of the
 * production path would do. Grounding here is only the shopping list's raw
 * matcher (`namesMatch`) with no alias table — S2 builds the real one, seeded
 * from the misses this script prints.
 *
 *   GEMINI_API_KEY_SECRET_ARN=<arn> AWS_PROFILE=parimaan-dev \
 *     pnpm tsx scripts/cookFromPantrySpike.ts <outFile.json> [temperature]
 */

const TIMEOUT_MS = 45_000;

/** Naive obedience checks: does the raw output break a household rule? (S2 builds the real filters.) */
const ROOT_VEG = ['onion', 'garlic', 'potato', 'ginger', 'carrot', 'radish', 'beetroot', 'aloo', 'pyaz'];
const MEAT = ['chicken', 'mutton', 'fish', 'prawn', 'lamb', 'beef', 'pork', 'meat'];

interface SuggestionReport {
  /** The whole parsed suggestion, kept so a human can rate its usefulness (D12) from the results file alone. */
  draft: GeminiCookSuggestions['suggestions'][number];
  title: string;
  ingredientCount: number;
  haveCount: number;
  missing: string[];
  haveRatio: number;
  skipViolations: string[];
  allergenViolations: string[];
  dietViolations: string[];
}

interface CallReport {
  fixture: string;
  vibe: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  suggestions: SuggestionReport[];
}

const norm = normalizeIngredientName;

/** Whole-word match (so "potato" does not hit "sweet potato" only by accident of substring, and "meat" does not hit "meatless"); blank terms match nothing. */
const containsTerm = (haystack: string, term: string): boolean => {
  const t = term.trim().toLowerCase();
  return t !== '' && new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?($|[^a-z])`).test(haystack);
};
const inPantry = (name: string, pantry: readonly string[]): boolean => pantry.some((p) => namesMatch(norm(p), norm(name)));

const reportSuggestion = (
  fixture: CookSpikeFixture,
  s: GeminiCookSuggestions['suggestions'][number],
): SuggestionReport => {
  const pantry = fixture.context.pantry;
  const names = s.ingredients.map((i) => i.name);
  const assumed = (n: string): boolean => ['water', 'salt'].includes(norm(n));
  const have = names.filter((n) => !assumed(n) && inPantry(n, pantry));
  const missing = names.filter((n) => !assumed(n) && !inPantry(n, pantry));
  const haystack = [s.title, ...names].map((t) => t.toLowerCase());
  const hits = (terms: readonly string[]): string[] => terms.filter((term) => haystack.some((h) => containsTerm(h, term)));
  const jain = fixture.context.dietaryTags.includes('jain');
  const veg = fixture.context.dietaryTags.some((t) => ['veg', 'jain', 'vegan'].includes(t));
  return {
    draft: s,
    title: s.title,
    ingredientCount: names.length,
    haveCount: have.length,
    missing,
    haveRatio: have.length + missing.length === 0 ? 0 : have.length / (have.length + missing.length),
    skipViolations: hits(fixture.context.skipIngredients),
    allergenViolations: hits(fixture.context.allergens),
    dietViolations: [...(jain ? hits(ROOT_VEG) : []), ...(veg ? hits(MEAT) : [])],
  };
};

const runOne = async (fixture: CookSpikeFixture, vibe: CookVibe, temperature: number): Promise<CallReport> => {
  const prompt = buildCookFromPantryPrompt({ ...fixture.context, vibe });
  const started = Date.now();
  const failed = (error: unknown, tokens = { promptTokens: 0, outputTokens: 0 }): CallReport => ({
    fixture: fixture.id,
    vibe,
    ok: false,
    // The secret's ARN can appear in a client error message; keep it out of a file that may be shared.
    error: (error instanceof Error ? error.message : String(error)).replace(/arn:aws:[^\s'"]+/g, '[arn]'),
    latencyMs: Date.now() - started,
    ...tokens,
    suggestions: [],
  });
  let result: Awaited<ReturnType<typeof callGemini>>;
  try {
    result = await callGemini(prompt, { timeoutMs: TIMEOUT_MS, temperature, maxOutputTokens: COOK_MAX_OUTPUT_TOKENS });
  } catch (error) {
    return failed(error);
  }
  // Token counts are kept even when the answer is unusable: a truncated response is exactly the case that sizes maxOutputTokens (D10).
  const tokens = { promptTokens: result.usage.promptTokens, outputTokens: result.usage.candidateTokens };
  const base = { fixture: fixture.id, vibe, latencyMs: Date.now() - started, ...tokens };
  try {
    const parsed = geminiCookSuggestionsSchema.safeParse(JSON.parse(result.rawText));
    if (!parsed.success) {
      return { ...base, ok: false, error: `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, suggestions: [] };
    }
    return { ...base, ok: true, suggestions: parsed.data.suggestions.map((s) => reportSuggestion(fixture, s)) };
  } catch (error) {
    return failed(error, tokens);
  }
};

/** Nearest-rank percentile of an ascending list. */
const percentile = (sorted: readonly number[], p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;

const latencyStats = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0 };
};

const parseTemperature = (arg: string | undefined): number => {
  const value = arg === undefined ? COOK_TEMPERATURE : Number(arg);
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`Temperature must be a number from 0 to 2, got "${String(arg)}".`);
  }
  return value;
};

const countMisses = (misses: readonly string[]): [string, number][] => {
  const counts = new Map<string, number>();
  for (const miss of misses) {
    counts.set(norm(miss), (counts.get(norm(miss)) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
};

const summarize = (reports: readonly CallReport[], temperature: number) => {
  const ok = reports.filter((r) => r.ok);
  const all = reports.flatMap((r) => r.suggestions);
  const grounded = (r: CallReport): boolean =>
    r.suggestions.filter((s) => s.missing.length <= PROMPT_LIMITS.missing && s.haveCount >= PROMPT_LIMITS.minPantryItems).length >= 2;
  const groundedCalls = reports.filter(grounded).length;
  return {
    model: GEMINI_MODEL,
    promptVersion: PROMPT_VERSION,
    temperature,
    calls: reports.length,
    failures: reports.length - ok.length,
    // D12's p95 rule is about the calls that produced an answer; a fast 429 or a 45s timeout would distort it either way, so both are shown.
    latencyMsOkCalls: latencyStats(ok.map((r) => r.latencyMs)),
    latencyMsAllCalls: latencyStats(reports.map((r) => r.latencyMs)),
    maxOutputTokens: Math.max(0, ...reports.map((r) => r.outputTokens)),
    meanHaveRatio: all.length === 0 ? 0 : all.reduce((sum, s) => sum + s.haveRatio, 0) / all.length,
    // D3's thresholds on the RAW matcher (no aliases). D12's rule: at least 2 grounded suggestions in >= 80% of calls.
    callsWithAtLeast2Grounded: groundedCalls,
    groundedCallShare: reports.length === 0 ? 0 : groundedCalls / reports.length,
    skipViolations: all.filter((s) => s.skipViolations.length > 0).length,
    allergenViolations: all.filter((s) => s.allergenViolations.length > 0).length,
    dietViolations: all.filter((s) => s.dietViolations.length > 0).length,
    commonMisses: countMisses(all.flatMap((s) => s.missing)),
  };
};

const main = async (): Promise<void> => {
  const outFile = process.argv[2];
  if (outFile === undefined) {
    process.stderr.write('Usage: tsx scripts/cookFromPantrySpike.ts <outFile.json> [temperature]\n');
    process.exit(1);
  }
  const temperature = parseTemperature(process.argv[3]);
  const reports: CallReport[] = [];
  for (const fixture of COOK_SPIKE_FIXTURES) {
    for (const vibe of COOK_VIBE_VALUES) {
      process.stderr.write(`${fixture.id} / ${vibe} ... `);
      const report = await runOne(fixture, vibe, temperature);
      reports.push(report);
      process.stderr.write(`${report.ok ? 'ok' : `FAIL (${report.error ?? '?'})`} ${String(report.latencyMs)}ms, ${String(report.suggestions.length)} suggestions\n`);
    }
  }
  const summary = summarize(reports, temperature);
  writeFileSync(outFile, JSON.stringify({ summary, reports }, null, 2));
  process.stderr.write(`\n${JSON.stringify(summary, null, 2)}\nWritten to ${outFile}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
