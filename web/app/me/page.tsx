import { getServerSession } from 'next-auth';
import { buildAuthOptions } from '@/auth/config';
import { requireIdToken } from '@/auth/requireIdToken';
import { MeClient } from '@/graphql/MeClient';
import { ME_QUERY, type MeQueryResult } from '@/graphql/queries';
import { createServerUrqlClient } from '@/graphql/serverClient';

// Same reasoning as `app/page.tsx` — never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * W18 S3's proof-of-life page: sign-in → token → one authenticated
 * `Query.me` call, rendered twice — once server-side (via
 * `getServerSession` + `createServerUrqlClient`) and once client-side (via
 * `MeClient`'s `useSession` + `UrqlClientProvider`) — proving both halves of
 * D2's "both SSR and client components read it" requirement actually work,
 * not just one. `requireIdToken` redirects to sign-in instead of rendering
 * with no data when there is no session.
 */
export default async function MePage() {
  const options = await buildAuthOptions();
  const session = await getServerSession(options);
  const idToken = requireIdToken(session, '/me');

  const client = createServerUrqlClient(idToken);
  const result = await client.query<MeQueryResult>(ME_QUERY, {}).toPromise();

  return (
    <main>
      <h1>Signed in</h1>
      <section>
        <h2>Server-rendered Query.me</h2>
        {result.error ? (
          <p role="alert">Error: {result.error.message}</p>
        ) : (
          <pre data-testid="me-server-result">{JSON.stringify(result.data?.me, null, 2)}</pre>
        )}
      </section>
      <section>
        <h2>Client-rendered Query.me</h2>
        <MeClient />
      </section>
    </main>
  );
}
