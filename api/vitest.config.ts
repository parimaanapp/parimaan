import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `api/src/db/migrations.test.ts` pulls a real `postgres:16` image via
    // Testcontainers and boots an ephemeral container per test run (per
    // docs/DEV_WORKFLOW.md §3.2: real Postgres, not a mocked `pg` client, so
    // RLS policies are actually exercised). First-run image pull plus
    // container startup comfortably exceeds Vitest's 5000ms default, even
    // though a warm-cache repeat run is fast — same category of issue as the
    // aws-cdk-lib cold-start timeout fixed in infra/vitest.config.ts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
