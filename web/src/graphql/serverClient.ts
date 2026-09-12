import 'server-only';
import { cacheExchange, Client, fetchExchange } from 'urql';
import { buildAuthorizationHeaders } from './authHeader';
import { requireGraphqlUrl } from './graphqlUrl';

/**
 * W18 D2's server-side urql client — used from server components and Route
 * Handlers, where the caller already has the real ID token from
 * `getServerSession`. A new `Client` per call (not a module-scope singleton)
 * deliberately: the token differs per request/session, and urql's own
 * Next.js App Router guidance (`@urql/next`'s docs) is explicit that a
 * request-scoped client is the correct shape for anything whose config
 * depends on the request — a module-scope singleton here would either leak
 * one user's token to another's request on a warm instance, or require a
 * second, more complex "swap the token on every call" mechanism for no
 * benefit, since this client has no persistent cache worth keeping across
 * requests (each server-rendered page issues its own `Query.me` once).
 */
export const createServerUrqlClient = (idToken: string): Client =>
  new Client({
    url: requireGraphqlUrl(),
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => ({
      headers: buildAuthorizationHeaders(idToken),
    }),
  });
