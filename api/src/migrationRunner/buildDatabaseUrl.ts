export interface BuildDatabaseUrlParams {
  username: string;
  password: string;
  host: string;
  port: number;
  dbName: string;
}

/**
 * Builds a `postgres://` connection URL, percent-encoding every string
 * field. `username`/`password` come from a Secrets-Manager-fetched admin
 * credential pair at runtime and are the primary reason for encoding —
 * they could in principle contain characters (`@`, `:`, `/`, `%`) that
 * would otherwise be misparsed as URL delimiters. `host`/`dbName` are
 * effectively trusted/constant in every caller today (a CDK-derived
 * cluster endpoint and a hardcoded database name), but the function's own
 * type signature doesn't encode that trust boundary — encoding all four
 * uniformly means a future caller can't introduce a malformed URL by
 * passing a less-trusted `host`/`dbName`, and is a no-op for the
 * plain-hostname/plain-identifier values used today.
 */
export const buildDatabaseUrl = ({
  username,
  password,
  host,
  port,
  dbName,
}: BuildDatabaseUrlParams): string => {
  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  const encodedHost = encodeURIComponent(host);
  const encodedDbName = encodeURIComponent(dbName);
  return `postgres://${encodedUsername}:${encodedPassword}@${encodedHost}:${port}/${encodedDbName}`;
};
