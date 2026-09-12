'use client';

import { useQuery } from 'urql';
import { ME_QUERY, type MeQueryResult } from './queries';

/**
 * Client-side half of W18 S3's proof-of-life: the same `Query.me` call as
 * `app/me/page.tsx`'s server-rendered half, but issued via `useQuery` +
 * `UrqlClientProvider` (reading the token from `useSession()` instead of
 * `getServerSession`) — demonstrating both contexts D2 requires actually
 * work, not just one of them.
 */
export function MeClient() {
  const [result] = useQuery<MeQueryResult>({ query: ME_QUERY });

  if (result.fetching) {
    return <p>Loading…</p>;
  }
  if (result.error) {
    return <p role="alert">Error: {result.error.message}</p>;
  }
  return <pre data-testid="me-client-result">{JSON.stringify(result.data?.me, null, 2)}</pre>;
}
