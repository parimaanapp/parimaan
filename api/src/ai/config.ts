import { z } from 'zod';

/**
 * `process.env` is an untrusted boundary (coding-style rule: validate at
 * system boundaries) — a missing or malformed `GEMINI_API_KEY_SECRET_ARN`
 * should fail loudly and specifically at cold start, not several calls deep
 * into a fetch with `undefined` in an auth header. Same single-Zod-schema
 * shape as `db/config.ts`'s `loadDbConfig`, deliberately — this is the
 * second Lambda category (non-VPC, AI/net) to need a cold-start-validated
 * secret ARN, not a novel pattern.
 */
const envSchema = z.object({
  GEMINI_API_KEY_SECRET_ARN: z.string().min(1, 'GEMINI_API_KEY_SECRET_ARN must be set'),
});

export interface AiConfig {
  geminiApiKeySecretArn: string;
}

/**
 * Parses and validates the env vars the non-VPC AI Lambdas need. Throws a
 * `ZodError` naming exactly which var is missing/invalid — `env` defaults to
 * `process.env` but is overridable for tests.
 */
export const loadAiConfig = (env: Record<string, string | undefined> = process.env): AiConfig => {
  const parsed = envSchema.parse(env);
  return {
    geminiApiKeySecretArn: parsed.GEMINI_API_KEY_SECRET_ARN,
  };
};
