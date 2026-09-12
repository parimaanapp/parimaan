import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SessionProviderClient } from '@/auth/SessionProviderClient';
import { UrqlClientProvider } from '@/graphql/UrqlClientProvider';

export const metadata: Metadata = {
  title: 'Parimaan',
  description: 'Household meal planning dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProviderClient>
          <UrqlClientProvider>{children}</UrqlClientProvider>
        </SessionProviderClient>
      </body>
    </html>
  );
}
