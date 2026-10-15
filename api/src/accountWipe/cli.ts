import type { RunWipeOptions } from './runWipe.js';
import type { ExpectedTarget } from './target.js';

const EMAIL_FLAGS_HELP = 'Provide accounts with --emails a@x,b@y or --emails-file <path>.';

interface RawArgs {
  dryRun: boolean;
  execute: boolean;
  confirm: string | undefined;
  emails: string[];
  fullListing: string | undefined;
}

export type CliOptions = RunWipeOptions & {
  /** Where to write the complete (untruncated) listing for sign-off. */
  readonly fullListingPath?: string;
};

const readEmailsFile = (content: string): string[] =>
  content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

const collectArgs = (argv: readonly string[], readFile: (path: string) => string): RawArgs => {
  const raw: RawArgs = { dryRun: false, execute: false, confirm: undefined, emails: [], fullListing: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const takesValue = ['--confirm', '--emails', '--emails-file', '--full-listing'].includes(arg);
    const value = takesValue ? argv[i + 1] : undefined;
    if (takesValue) {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      i += 1;
    }
    applyArg(raw, arg, value, readFile);
  }
  return raw;
};

const applyArg = (
  raw: RawArgs,
  arg: string,
  value: string | undefined,
  readFile: (path: string) => string,
): void => {
  if (arg === '--dry-run') raw.dryRun = true;
  else if (arg === '--execute') raw.execute = true;
  else if (arg === '--confirm') raw.confirm = value;
  else if (arg === '--full-listing') raw.fullListing = value;
  else if (arg === '--emails') raw.emails.push(...(value as string).split(','));
  else if (arg === '--emails-file') raw.emails.push(...readEmailsFile(readFile(value as string)));
  else throw new Error(`Unknown argument: ${arg}`);
};

export const parseCliArgs = (
  argv: readonly string[],
  readFile: (path: string) => string,
): CliOptions => {
  const { dryRun, execute, confirm, emails, fullListing } = collectArgs(argv, readFile);
  const extra = fullListing === undefined ? {} : { fullListingPath: fullListing };
  if (dryRun && execute) {
    throw new Error('Choose either --dry-run or --execute, not both.');
  }
  if (emails.length === 0) {
    throw new Error(`No accounts given. ${EMAIL_FLAGS_HELP}`);
  }
  if (!execute) {
    if (confirm !== undefined) {
      throw new Error('--confirm is only valid with --execute.');
    }
    return { mode: 'dry-run', emails, ...extra };
  }
  if (confirm === undefined) {
    throw new Error('--execute requires --confirm <listing-hash> from an approved dry run.');
  }
  return { mode: 'execute', emails, confirm, ...extra };
};

export interface DatabaseConnectionParts {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly name: string;
}

export interface WipeConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly uploadsBucket: string;
  readonly exportsBucket: string;
  readonly cacheTable: string;
  /** Parsed from WIPE_DATABASE_URL. The raw URL is never kept or passed to `pg`. */
  readonly database: DatabaseConnectionParts;
  /** The host the connection really terminates at: the servername override, else the URL host. */
  readonly dbHost: string;
  /** TLS servername used to verify the certificate; set when the URL host is a port-forward (localhost). */
  readonly dbServername?: string;
  readonly expected: ExpectedTarget;
}

const REQUIRED = [
  'AWS_REGION',
  'WIPE_USER_POOL_ID',
  'WIPE_UPLOADS_BUCKET',
  'WIPE_EXPORTS_BUCKET',
  'WIPE_CACHE_TABLE',
  'WIPE_DATABASE_URL',
  'WIPE_EXPECTED_ACCOUNT_ID',
  'WIPE_EXPECTED_POOL_NAME',
  'WIPE_EXPECTED_DB_HOST',
  'WIPE_EXPECTED_DB_NAME',
] as const;

const ACCOUNT_ID_PATTERN = /^\d{12}$/;
const DEFAULT_PG_PORT = 5432;

/**
 * `pg` lets connection-string parameters (`host`, `port`, `ssl`, `sslrootcert`,
 * `options`, `uselibpqcompat`, ...) override explicit config, which would bypass
 * the host guard and TLS. So the URL may carry NO query string; it is only a
 * carrier for host, port, user, password and database name.
 */
const parseDatabaseUrl = (databaseUrl: string): DatabaseConnectionParts => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Deliberately not echoing the value: it contains credentials.
    throw new Error('WIPE_DATABASE_URL is not a valid connection URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('WIPE_DATABASE_URL must be a postgres:// or postgresql:// URL.');
  }
  if (url.search.length > 0 || databaseUrl.includes('?')) {
    const names = [...new Set([...url.searchParams.keys()])];
    throw new Error(
      'WIPE_DATABASE_URL must not contain a query string: parameters override the verified connection ' +
        'settings (host, port, TLS, options). TLS is always verified against the RDS CA bundle; ' +
        'use WIPE_DATABASE_SERVERNAME for a port-forward.' +
        (names.length > 0 ? ` Found parameter(s): ${names.join(', ')}.` : ''),
    );
  }
  if (url.hash.length > 0 || databaseUrl.includes('#')) {
    throw new Error('WIPE_DATABASE_URL must not contain a fragment.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (name.length === 0 || name.includes('/')) {
    throw new Error(
      'WIPE_DATABASE_URL must include the database name (postgres://user:pw@host:port/<name>).',
    );
  }
  if (url.hostname.length === 0) {
    throw new Error('WIPE_DATABASE_URL must include a host.');
  }
  return {
    host: url.hostname,
    port: url.port.length > 0 ? Number(url.port) : DEFAULT_PG_PORT,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    name,
  };
};

/** libpq environment variables `pg` silently falls back to (notably `PGOPTIONS`, `PGSSLMODE`). */
const assertNoAmbientPgEnv = (env: Record<string, string | undefined>): void => {
  const present = Object.keys(env).filter((k) => k.startsWith('PG') && (env[k] ?? '').length > 0);
  if (present.length > 0) {
    throw new Error(
      `Refusing to run with libpq environment variable(s) set: ${present.join(', ')}. ` +
        'They can override the verified connection settings; unset them.',
    );
  }
};

/**
 * Reads all targets from env, never from code. The dev-only guard is bound to
 * real targets, with no defaults: the AWS account, user pool name, database
 * host and database name must each equal an `WIPE_EXPECTED_*` value (the account
 * and pool are checked against AWS in `target.ts`, host and database name
 * against the live connection). `WIPE_ENV=dev` and the `-dev` name suffixes
 * remain as extra self-assertions only.
 * (The AWS profile itself is picked up by the SDK from `AWS_PROFILE`.)
 */
export const loadWipeConfig = (env: Record<string, string | undefined>): WipeConfig => {
  if (env['WIPE_ENV'] !== 'dev') {
    throw new Error('WIPE_ENV must be set to "dev". This tool is dev-only and refuses anything else.');
  }
  const missing = REQUIRED.filter((name) => (env[name] ?? '').length === 0);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}.`);
  }
  assertNoAmbientPgEnv(env);
  const get = (name: (typeof REQUIRED)[number]): string => env[name] as string;
  const names = [get('WIPE_UPLOADS_BUCKET'), get('WIPE_EXPORTS_BUCKET'), get('WIPE_CACHE_TABLE')];
  if (!names.every((n) => n.endsWith('-dev'))) {
    throw new Error('Bucket and table names must be -dev resources (they must end in "-dev").');
  }
  if (!ACCOUNT_ID_PATTERN.test(get('WIPE_EXPECTED_ACCOUNT_ID'))) {
    throw new Error('WIPE_EXPECTED_ACCOUNT_ID must be the 12 digits of the AWS account id.');
  }
  const database = parseDatabaseUrl(get('WIPE_DATABASE_URL'));
  const servername = (env['WIPE_DATABASE_SERVERNAME'] ?? '').trim();
  return {
    region: get('AWS_REGION'),
    userPoolId: get('WIPE_USER_POOL_ID'),
    uploadsBucket: get('WIPE_UPLOADS_BUCKET'),
    exportsBucket: get('WIPE_EXPORTS_BUCKET'),
    cacheTable: get('WIPE_CACHE_TABLE'),
    database,
    dbHost: servername.length > 0 ? servername : database.host,
    ...(servername.length > 0 ? { dbServername: servername } : {}),
    expected: {
      accountId: get('WIPE_EXPECTED_ACCOUNT_ID'),
      poolName: get('WIPE_EXPECTED_POOL_NAME'),
      dbHost: get('WIPE_EXPECTED_DB_HOST'),
      dbName: get('WIPE_EXPECTED_DB_NAME'),
    },
  };
};
