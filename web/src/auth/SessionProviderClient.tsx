'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * `useSession()` (client components) requires a `SessionProvider` ancestor —
 * NextAuth's own documented App Router requirement. Wrapped in its own
 * client component (rather than making `app/layout.tsx` itself a client
 * component) so the root layout stays a server component wherever possible.
 */
export function SessionProviderClient({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
