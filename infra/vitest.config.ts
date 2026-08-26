import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // aws-cdk-lib + jsii cold-start (module load, runtime init) on a fresh
    // Vitest worker comfortably exceeds the 5000ms default on GitHub Actions'
    // shared runners, even though it's fast on a local warm-cache machine —
    // confirmed via CI failure on PR #5, where every stack's first
    // `synthesizes without error` test timed out at exactly 5000ms. Later
    // synth calls in the same worker are fast (modules already loaded), so
    // this is a one-time-per-worker cost, not a sign anything is slow.
    // Bumped again 15_000 → 25_000 (W5 S8): api-stack.test.ts's own resolver
    // count has grown from 6 to 16 Lambdas since the comment below was
    // written, each bundled via esbuild on every synth call — CI reproduced
    // a "synthesizes without error for dev" timeout at 15_000ms twice in a
    // row on PR #34 (not a one-off; a rerun didn't fix it), immediately
    // after "for prod" alone had already taken 8.7s on that runner.
    testTimeout: 25_000,
    // Cuts per-file cold start (each file no longer re-pays the
    // jsii/aws-cdk-lib module-load cost), a genuine local speedup, but did
    // NOT fix the CI-only "[vitest-worker]: Timeout calling 'onTaskUpdate'"
    // failure on its own (confirmed on PR #11: still failed a 3rd time with
    // the identical error, same place, after this was already in place).
    // Kept anyway for the real perf win; see `onConsoleLog` below for the
    // actual fix.
    isolate: false,
    // The real cause: every ApiStack test does a full CDK synth, and each
    // synth bundles every resolver Lambda via esbuild (NodejsFunction, 6 at
    // the time this was written, 16 as of W5 S8), which console.logs 2
    // lines per Lambda ("Bundling asset..." / "Done in Xms"). Across the
    // many tests in api-stack.test.ts that's 1000+ lines of
    // stdout, all relayed to the main thread over the same worker IPC
    // channel vitest uses for its own "onTaskUpdate" progress heartbeat —
    // on GitHub Actions' constrained runners that volume appears to be
    // enough to starve the heartbeat past its 60s birpc timeout, even
    // though every actual test passes (confirmed 108/108 green on all 3
    // failed CI runs). `'passed-only'` drops a passing test's console
    // output entirely but still prints it for a failing one, so debugging
    // a real failure isn't affected.
    silent: 'passed-only',
  },
});
