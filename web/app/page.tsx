import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { buildAuthOptions } from '@/auth/config';
import { SignInButton } from '@/auth/SignInButton';

// Sign-in state is inherently per-request (reads the session cookie); never
// statically prerendered at build time, which would otherwise attempt a
// real Secrets Manager call (via `buildAuthOptions`) during `next build`
// itself rather than at request time.
export const dynamic = 'force-dynamic';

/**
 * Home/sign-in page (W18 S3). An already-signed-in caller is sent straight
 * to `/me` (the proof-of-life page) rather than shown a redundant sign-in
 * button.
 */
export default async function HomePage() {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);

  if (session?.idToken) {
    redirect('/me');
  }

  return (
    <main>
      <h1>Parimaan</h1>
      <p>Sign in to view your household dashboard.</p>
      <SignInButton />
    </main>
  );
}
