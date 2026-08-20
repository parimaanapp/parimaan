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
    testTimeout: 15_000,
    // Vitest's default `isolate: true` gives every test FILE a fresh module
    // registry, so each of our 5 files re-pays the jsii/aws-cdk-lib
    // cold-start cost independently — even with fileParallelism disabled
    // (tried first; didn't help, since the cost is per-file, not just
    // per-parallel-worker). That repeated heavy synchronous synth work is
    // what starves the event loop long enough for the worker's IPC
    // heartbeat back to the main thread ("onTaskUpdate", 60s birpc default)
    // to time out — even though every individual test still passes well
    // within testTimeout (confirmed on PR #11: 108/108 tests green twice,
    // but the run still failed both times with "[vitest-worker]: Timeout
    // calling 'onTaskUpdate'"). Sharing one module registry across files in
    // the same worker means the cold start is paid once, not 5 times.
    isolate: false,
  },
});
