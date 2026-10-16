import { RDS_GLOBAL_BUNDLE_CA } from '../src/db/rdsGlobalBundleCa.js';

/**
 * Connection settings for the maintenance scripts, from the environment only
 * (no secret is printed): PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD required,
 * PGSERVERNAME optional (TLS server name for an SSM port-forward to RDS).
 * Remote hosts are verified against the RDS global CA bundle; localhost is not
 * TLS-wrapped.
 */
const REQUIRED = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

export const readPgConfig = (env: NodeJS.ProcessEnv) => {
  const missing = REQUIRED.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  const host = env['PGHOST'] as string;
  const port = Number(env['PGPORT']);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PGPORT must be a positive integer.');
  }
  const servername = (env['PGSERVERNAME'] ?? '').trim();
  return {
    host,
    port,
    database: env['PGDATABASE'] as string,
    user: env['PGUSER'] as string,
    password: env['PGPASSWORD'] as string,
    ssl: LOCAL_HOSTS.has(host)
      ? false
      : {
          rejectUnauthorized: true,
          ca: RDS_GLOBAL_BUNDLE_CA,
          ...(servername === '' ? {} : { servername }),
        },
  };
};
