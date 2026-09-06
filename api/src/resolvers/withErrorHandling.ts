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
 * client response. For a Direct Lambda Resolver with no VTL in front (every
 * resolver in this stack — see `infra/stacks/api-stack.ts`), AppSync's
 * wire-level `errorType` sibling comes from the Lambda runtime's own
 * invocation-error envelope, which Node derives from the thrown error's
 * `name` (defaulting to the generic string "Error" for a plain
 * `new Error(...)`) — NOT from an arbitrary same-named own property. Setting
 * only an `errorType` own-property (as this used to do) is inert on the
 * wire: every typed error was silently downgraded to a generic "Error", and
 * any client logic branching on a specific errorType (e.g. `ConflictError`
 * triggering a redirect) silently fell through to its default case. Setting
 * `name` is what actually reaches the client (`errors.ts`'s `AppError` base
 * class does the same for the in-process object, via `this.name =
 * new.target.name`). The `errorType` own-property is kept alongside it —
 * inert on the real AppSync wire, but relied on by this file's own unit
 * tests and by any direct (non-AppSync) Lambda invoke, which see the raw
 * thrown object rather than its Lambda-runtime-serialized wire form.
 */
export const withErrorHandling =
  <Event, Result>(handler: (event: Event) => Promise<Result>) =>
  async (event: Event): Promise<Result> => {
    try {
      return await handler(event);
    } catch (error) {
      console.error('Resolver error:', error);
      const clientError = toClientError(error);
      const clientSafeError = Object.assign(new Error(clientError.errorMessage), {
        errorType: clientError.errorType,
      });
      clientSafeError.name = clientError.errorType;
      throw clientSafeError;
    }
  };
