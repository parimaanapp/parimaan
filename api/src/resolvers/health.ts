import type { AppSyncResolverEvent } from 'aws-lambda';

/**
 * Direct-Lambda AppSync resolver for `Query._health`. AppSync direct Lambda
 * resolvers are not VTL-mapped and not API Gateway proxy events — the return
 * value becomes the GraphQL field's response directly, no wrapper object.
 *
 * Intentionally the simplest possible resolver: proves the AppSync → Lambda
 * → response pipeline works end-to-end before any real business logic lands.
 */
export const handler = async (
  _event: AppSyncResolverEvent<Record<string, never>>,
): Promise<string> => 'ok';
