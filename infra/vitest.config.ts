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
  },
});
