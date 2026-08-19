/**
 * Redacts content-addressed Lambda asset hashes (`"<64-hex>.zip"` S3 keys)
 * from a synthesized CloudFormation template before snapshotting.
 *
 * These hashes are derived from the exact bytes of a bundled Lambda's
 * output directory. For any Lambda whose bundle copies from the live
 * filesystem (e.g. the migration-runner's `cp -RL` of an installed
 * dependency — see `infra/stacks/data-stack.ts`), that hash is not
 * guaranteed identical across machines/CI runners even when the
 * dependency *version* is pinned by a frozen lockfile — confirmed
 * empirically: a real CI run produced a different `S3Key` than the
 * locally-committed snapshot despite identical `pnpm-lock.yaml`-pinned
 * versions. A snapshot test asserting on that value is asserting on
 * bundling-environment entropy, not on any reviewable intent — exactly
 * what the "change-detector, not to encode intent on its own" comment on
 * every snapshot test in this suite already says these tests are for.
 */
export const redactAssetHashes = (template: unknown): unknown =>
  JSON.parse(JSON.stringify(template).replace(/"[0-9a-f]{64}\.zip"/g, '"<ASSET_HASH>.zip"'));
