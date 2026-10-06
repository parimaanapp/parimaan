#!/usr/bin/env bash
# Uploads a signed release APK to the private beta-distribution bucket and
# prints a time-limited presigned GET URL for it.
#
# This bucket (`parimaan-beta-builds-{env}`) is deliberately NOT a product
# bucket — it holds build artifacts for the beta, not app data, so it is
# kept separate from `parimaan-uploads-{env}`/`parimaan-exports-{env}`
# (which have their own, different lifecycle rules tied to pantry photos and
# shopping-list exports) rather than mixed into either. It is NOT yet CDK-
# managed (created directly via `aws s3api create-bucket` for the 2026-10-06
# beta push) — named here as real IaC debt, not silently carried forward:
# if this becomes a recurring need past this one beta round, it should move
# into `infra/stacks/data-stack.ts` alongside the other two buckets.
#
# Usage:
#   scripts/beta/presign-android-build.sh [path/to/app-release.apk] [expiry-seconds]
#
# Defaults: mobile/build/app/outputs/flutter-apk/app-release.apk, 7 days.

set -euo pipefail

APK_PATH="${1:-mobile/build/app/outputs/flutter-apk/app-release.apk}"
EXPIRY_SECONDS="${2:-604800}" # 7 days
BUCKET="parimaan-beta-builds-dev"
PROFILE="${AWS_PROFILE:-parimaan-dev}"

if [[ ! -f "$APK_PATH" ]]; then
  echo "error: APK not found at $APK_PATH — run 'flutter build apk --release' first" >&2
  exit 1
fi

VERSION_LABEL="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="android/parimaan-beta-${VERSION_LABEL}.apk"

echo "Uploading $APK_PATH -> s3://${BUCKET}/${KEY} ..."
aws s3 cp "$APK_PATH" "s3://${BUCKET}/${KEY}" \
  --profile "$PROFILE" \
  --content-type "application/vnd.android.package-archive" \
  --no-progress

echo "Generating a presigned URL (expires in ${EXPIRY_SECONDS}s) ..."
URL="$(aws s3 presign "s3://${BUCKET}/${KEY}" \
  --profile "$PROFILE" \
  --expires-in "$EXPIRY_SECONDS")"

echo
echo "Beta APK ready. Share this link with testers (expires in $((EXPIRY_SECONDS / 86400)) days):"
echo "$URL"
