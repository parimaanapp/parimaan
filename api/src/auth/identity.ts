import { z } from 'zod';
import { UnauthorizedError } from '../errors.js';

export interface CallerIdentity {
  cognitoSub: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Cognito's id-token claims land on `event.identity.claims` (an `any` in
 * `@types/aws-lambda`, per the attribute mapping configured in
 * `infra/stacks/auth-stack.ts`). This is an untrusted boundary — the shape
 * is validated here, not assumed, before anything downstream trusts it.
 * Only `email` is required among the mapped claims; `name`/`picture` are
 * genuinely optional (e.g. some Google accounts omit `picture`). Upper
 * bounds are defense-in-depth, not because Cognito is expected to send
 * anything this long — if the attribute mapping in `infra/stacks/
 * auth-stack.ts` is ever misconfigured to pass through a longer
 * client-influenced value, this stops it from flowing unbounded into a
 * Postgres `text` column. 320 matches RFC 5321's email length limit; 256
 * is a generous cap for a display name or an image URL.
 */
const cognitoClaimsSchema = z.object({
  email: z.string().min(1).max(320),
  name: z.string().min(1).max(256).optional(),
  picture: z.string().min(1).max(256).optional(),
});

/**
 * The subset of `AppSyncIdentityCognito` this module actually relies on.
 * Narrowed structurally (not via `instanceof`, since AppSync identities are
 * plain JSON) rather than assuming every non-null `identity` is Cognito —
 * IAM/API-key-authorized requests carry a different shape entirely, and
 * casting instead of checking would let a `userArn`-shaped IAM identity
 * silently pass through as if it had a `sub`.
 */
const cognitoIdentitySchema = z.object({
  sub: z.string().min(1),
  claims: z.unknown(),
});

/**
 * Extracts and validates the authenticated caller's identity from an AppSync
 * direct-Lambda-resolver event's `event.identity`. Throws `UnauthorizedError`
 * for anything that isn't a well-formed Cognito identity: `null`/`undefined`
 * (unauthenticated), a non-Cognito shape (IAM/API-key auth), or missing
 * required fields (`sub`, `claims.email`) — this resolver slice only
 * supports `AMAZON_COGNITO_USER_POOLS` auth, per the settled design.
 */
export const extractCallerIdentity = (identity: unknown): CallerIdentity => {
  const parsedIdentity = cognitoIdentitySchema.safeParse(identity);
  if (!parsedIdentity.success) {
    throw new UnauthorizedError('Missing or non-Cognito caller identity.');
  }

  const parsedClaims = cognitoClaimsSchema.safeParse(parsedIdentity.data.claims);
  if (!parsedClaims.success) {
    throw new UnauthorizedError('Caller identity is missing required claims.');
  }

  return {
    cognitoSub: parsedIdentity.data.sub,
    email: parsedClaims.data.email,
    displayName: parsedClaims.data.name ?? null,
    avatarUrl: parsedClaims.data.picture ?? null,
  };
};
