import { toClientError } from '../errors.js';

/**
 * Wraps a resolver handler so any thrown error is converted to a
 * client-safe shape before it can leave the Lambda. This stack wires every
 * resolver via `addLambdaDataSource(...).createResolver(...)` with no VTL
 * response-mapping template in front of it (`infra/stacks/api-stack.ts`),
 * so AppSync's direct-Lambda-resolver protocol surfaces a thrown error's
 * message to the GraphQL client verbatim — without this wrapper, anything
 * this codebase doesn't specifically anticipate (a raw `pg` driver error, a
 * Secrets Manager fetch failure whose message embeds the secret ARN, ...)
 * would reach the client unmodified. `errors.ts`'s `toClientError` exists
 * exactly to prevent that; this is the one place responsible for actually
 * calling it — apply it to the exported production `handler` in every
 * resolver file, not to `createXHandler`'s returned function itself, so
 * existing unit tests can keep asserting on the original typed errors
 * (`UnauthorizedError`, `ValidationError`, ...) directly.
 *
 * Logs the original, unredacted error server-side (CloudWatch) before
 * throwing its sanitized replacement — the detail belongs in logs, not the
 * client response. AppSync recognizes a thrown error's own `errorType`
 * property (in addition to `message`) and surfaces it to the client, so the
 * client-safe `errorType` from `toClientError` is preserved, not just the
 * message.
 */
export const withErrorHandling =
  <Event, Result>(handler: (event: Event) => Promise<Result>) =>
  async (event: Event): Promise<Result> => {
    try {
      return await handler(event);
    } catch (error) {
      console.error('Resolver error:', error);
      const clientError = toClientError(error);
      throw Object.assign(new Error(clientError.errorMessage), {
        errorType: clientError.errorType,
      });
    }
  };
