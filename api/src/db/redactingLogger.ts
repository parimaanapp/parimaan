import type { RunnerOption } from 'node-pg-migrate';

/**
 * `Logger` isn't part of node-pg-migrate's public top-level export list
 * (verified against the installed v9.0.0 `dist/bundle/index.d.ts` — same
 * situation as `MigrationDirection` in `runMigrations.ts`), so it's derived
 * from `RunnerOption['logger']` rather than imported directly.
 */
type Logger = NonNullable<RunnerOption['logger']>;

const REDACTED = '[REDACTED]';

/**
 * node-pg-migrate logs the full SQL text of a failing statement in its
 * query-error path (`db.js`'s `query()` catch block), unconditionally —
 * not gated behind `verbose`. A migration that embeds a plaintext secret
 * directly in SQL text (e.g. `CREATE ROLE ... PASSWORD '<secret>'`, which
 * Postgres DDL has no bind-parameter mechanism to avoid) would otherwise
 * leak that secret to CloudWatch the moment the statement fails for any
 * reason — role-already-exists, a transient connection drop, anything.
 * This wraps node-pg-migrate's logger so any known secret value is
 * substituted out of every log line before it reaches `console`.
 */
export const createRedactingLogger = (secrets: readonly string[]): Logger => {
  const knownSecrets = secrets.filter((secret) => secret.length > 0);

  const redact = (message: string): string =>
    knownSecrets.reduce((redacted, secret) => redacted.split(secret).join(REDACTED), message);

  // This file *is* the logging boundary: it exists to adapt to
  // node-pg-migrate's console-shaped Logger interface, matching the repo
  // lint rule's allowance of warn/error by also allowing the two lower
  // severities here rather than silently upgrading debug/info messages to
  // a warn/error level they don't belong at.
  return {
    debug: (msg: string) => {
      // eslint-disable-next-line no-console -- see comment above.
      console.debug(redact(msg));
    },
    info: (msg: string) => {
      // eslint-disable-next-line no-console -- see comment above.
      console.info(redact(msg));
    },
    warn: (msg: string) => {
      console.warn(redact(msg));
    },
    error: (msg: string) => {
      console.error(redact(msg));
    },
  };
};
