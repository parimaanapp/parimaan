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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // `types.ts` files hold only type/interface declarations that erase at
      // compile time — there's no runtime code for a test to exercise, so
      // counting them would just dilute the percentage with an unreachable
      // 0% rather than reflect anything untested (E2E_MVP_PLAN.md §0
      // amendment: >=80% coverage on real logic, not on type declarations).
      exclude: ['**/*.test.ts', '**/types.ts', 'src/testing/**'],
      // E2E_MVP_PLAN.md §0 amendment / docs/RUNBOOK.md's own coverage gap
      // note: >=80% on api/src, checked in aggregate (not per-file) so a
      // thin, legitimately-hard-to-unit-test file like db/pool.ts's real
      // `pg.Pool` wiring doesn't fail the build on its own — the suite's
      // actual behaviour is exercised through the resolver/repository tests
      // that call it, not through mocking `pg` directly.
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
