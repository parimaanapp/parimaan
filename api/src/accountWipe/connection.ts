import type { WipeConfig } from './cli.js';
import type { SqlClient } from './pgWipeDb.js';

/** The `pg.ClientConfig` subset the wipe tool builds; never a `connectionString`. */
export interface PgConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl: {
    readonly rejectUnauthorized: true;
    readonly ca: string;
    readonly servername?: string;
  };
}

/**
 * Builds the pg config from explicit parts. A connection string is never
 * passed: `pg` would let its query parameters override these fields.
 */
export const buildPgConfig = (
  config: Pick<WipeConfig, 'database' | 'dbServername'>,
  ca: string,
): PgConnectionConfig => ({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  ssl: {
    rejectUnauthorized: true,
    ca,
    // For an SSM port-forward the URL host is localhost; verify the certificate against the real RDS host.
    ...(config.dbServername !== undefined ? { servername: config.dbServername } : {}),
  },
});

/** After connect: the client must report the host we checked, not one a parameter redirected it to. */
export const assertConnectedHost = (
  client: { readonly host?: unknown },
  checkedHost: string,
): void => {
  const connected = client.host;
  if (typeof connected !== 'string' || connected.toLowerCase() !== checkedHost.toLowerCase()) {
    throw new Error(
      `Refusing to run: connected database host "${typeof connected === 'string' ? connected : '(unknown)'}" ` +
        `is not the checked host "${checkedHost}".`,
    );
  }
};

export const readCurrentDatabase = async (client: SqlClient): Promise<string> => {
  const { rows } = await client.query('SELECT current_database() AS name');
  return String(rows[0]?.['name'] ?? '');
};
