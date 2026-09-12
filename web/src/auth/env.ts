import 'server-only';
import { z } from 'zod';

/**
 * Non-secret config NextAuth's server-side setup needs, all already wired
 * into the Amplify app's environment variables by `frontend-stack.ts` (W18
 * S1) — except `AWS_REGION`, which AWS's own compute runtimes (Lambda,
 * Amplify Hosting's `WEB_COMPUTE` platform) set automatically and which this
 * app only reads, never derives or hardcodes (coding-style: no hardcoded
 * values).
 *
 * Validated eagerly, same `envSchema.parse` pattern as `api/src/ai/config.ts`'s
 * `loadAiConfig` — a missing var fails loudly at cold start with the exact
 * name, not several calls deep into a request with `undefined` silently
 * substituted.
 */
const envSchema = z.object({
  COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID must be set'),
  AWS_REGION: z.string().min(1, 'AWS_REGION must be set'),
});

export interface WebAuthConfig {
  cognitoUserPoolId: string;
  awsRegion: string;
  /** `https://cognito-idp.{region}.amazonaws.com/{userPoolId}` — OIDC issuer used for both sign-in discovery and refresh-token discovery. */
  issuer: string;
}

export const loadWebAuthConfig = (env: Record<string, string | undefined> = process.env): WebAuthConfig => {
  const parsed = envSchema.parse(env);
  return {
    cognitoUserPoolId: parsed.COGNITO_USER_POOL_ID,
    awsRegion: parsed.AWS_REGION,
    issuer: `https://cognito-idp.${parsed.AWS_REGION}.amazonaws.com/${parsed.COGNITO_USER_POOL_ID}`,
  };
};
