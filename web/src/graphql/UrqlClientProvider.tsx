'use client';

import { useSession } from 'next-auth/react';
import { useMemo, type ReactNode } from 'react';
import { Provider } from 'urql';
import { createClientUrqlClient } from './clientClient';

/**
 * W18 D2's client-side urql wiring: recreates the urql `Client` whenever
 * `useSession()`'s `idToken` changes, so a token refresh or sign-out is
 * reflected on the very next query a client component issues, without a
 * full page reload.
 */
export function UrqlClientProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const client = useMemo(() => createClientUrqlClient(session?.idToken), [session?.idToken]);
  return <Provider value={client}>{children}</Provider>;
}
