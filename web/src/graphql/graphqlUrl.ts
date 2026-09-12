/**
 * `NEXT_PUBLIC_APPSYNC_GRAPHQL_URL` — `frontend-stack.ts`'s own env var,
 * already non-secret (`ApiStack`'s `GraphQlUrl` `CfnOutput`, safe to be
 * public per that stack's own doc comment: every request is
 * Cognito-authorized regardless of who knows the URL). The `NEXT_PUBLIC_`
 * prefix is what makes Next.js inline it into the client bundle at build
 * time — deliberate here, unlike `WEB_CLIENT_CREDENTIALS_SECRET_ARN`, which
 * never gets that prefix. Read directly rather than through `env.ts`'s Zod
 * schema: that module is `server-only`-guarded and this value is read from
 * both server and client code.
 */
export const requireGraphqlUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_APPSYNC_GRAPHQL_URL must be set');
  }
  return url;
};
