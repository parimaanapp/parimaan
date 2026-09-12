/**
 * AppSync's `AMAZON_COGNITO_USER_POOLS` mode expects the raw Cognito ID
 * token in `Authorization` — no `Bearer ` prefix. Confirmed against the
 * mobile app's own working client
 * (`mobile/lib/shared/graphql/auth_link.dart`'s `AuthLink`, doc comment:
 * "AppSync tolerates [a `Bearer ` prefix], but the canonical form is the
 * bare token, and sending exactly one shape keeps the CloudWatch logs
 * readable") rather than assumed from the generic "Bearer token" shape — a
 * real instance of this slice's own instruction to verify the exact header
 * shape AppSync expects, not assume it. Shared by both the server and
 * client urql client factories so the two never drift.
 */
export const buildAuthorizationHeaders = (idToken: string | undefined): Record<string, string> =>
  idToken ? { Authorization: idToken } : {};
