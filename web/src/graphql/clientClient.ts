import { cacheExchange, Client, fetchExchange } from 'urql';
import { buildAuthorizationHeaders } from './authHeader';
import { requireGraphqlUrl } from './graphqlUrl';

/**
 * W18 D2's client-side urql client — used from client components via
 * `UrqlClientProvider`, which recreates this whenever `useSession()`'s
 * `idToken` changes (sign-in, sign-out, or a refreshed token). Deliberately
 * a plain `urql` `Client`, not `@urql/next`'s `registerUrql` singleton
 * pattern: that pattern is designed for config that is the same for every
 * request (e.g. a public API with no per-user auth header) and registers
 * one client for the whole app's lifetime — the wrong shape here, since
 * this app's `Authorization` header is per-session state that changes
 * within a single page's lifetime (sign-out, token refresh).
 */
export const createClientUrqlClient = (idToken: string | undefined): Client =>
  new Client({
    url: requireGraphqlUrl(),
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => ({
      headers: buildAuthorizationHeaders(idToken),
    }),
  });
