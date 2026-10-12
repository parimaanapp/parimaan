#!/usr/bin/env bash
# Builds a signed App Store .ipa of the mobile app, ready for TestFlight, and
# optionally uploads it.
#
# Prerequisites (one-time, all documented in docs/RUNBOOK.md "TestFlight"):
#   1. The paid Apple Developer account is signed into Xcode
#      (Xcode > Settings > Accounts), so automatic signing can create the
#      distribution certificate and provisioning profile.
#   2. `DEVELOPMENT_TEAM` is set on the Runner target (mobile/ios/Runner
#      .xcodeproj) — this script refuses to run without it rather than let
#      Xcode fail late with a less helpful message.
#   3. The app record exists in App Store Connect with bundle id
#      app.parimaan.mobile.
#
# Usage:
#   scripts/beta/build-ios-testflight.sh              # build only
#   UPLOAD=1 ASC_KEY_ID=… ASC_ISSUER_ID=… scripts/beta/build-ios-testflight.sh
#
# Upload without an API key: build only, then drag build/ios/ipa/*.ipa into
# Apple's Transporter app (or Xcode > Window > Organizer > Distribute App).
#
# Every upload needs a build number higher than the previous one; it defaults
# to the current minute (yymmddHHMM-ish, monotonic). Override with BUILD_NUMBER.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/mobile"
PBXPROJ="$MOBILE_DIR/ios/Runner.xcodeproj/project.pbxproj"
BUNDLE_ID="app.parimaan.mobile"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%m%d%H%M)}"

TEAM_ID="$(grep -m1 -E 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "$PBXPROJ" | sed -E 's/.*= ([A-Z0-9]{10});/\1/' || true)"
if [[ -z "$TEAM_ID" ]]; then
  echo "error: DEVELOPMENT_TEAM is not set in $PBXPROJ." >&2
  echo "       Sign into Xcode with the Apple Developer account, then set the team on the Runner target" >&2
  echo "       (Xcode > Runner > Signing & Capabilities), or ask for it to be committed." >&2
  exit 1
fi

if [[ -z "$(security find-identity -v -p codesigning 2>/dev/null | grep -E 'Apple Distribution|iPhone Distribution' || true)" ]]; then
  echo "note: no distribution certificate in the keychain yet — automatic signing will create one" >&2
  echo "      (needs the Apple account signed into Xcode)." >&2
fi

EXPORT_PLIST="$(mktemp -t parimaan-export-options).plist"
cat >"$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>export</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "Building ${BUNDLE_ID} (team ${TEAM_ID}), build number ${BUILD_NUMBER} ..."
cd "$MOBILE_DIR"
flutter build ipa --release \
  --build-number "$BUILD_NUMBER" \
  --export-options-plist "$EXPORT_PLIST"

IPA="$(ls -t "$MOBILE_DIR"/build/ios/ipa/*.ipa | head -1)"
echo
echo "Built: $IPA"

if [[ "${UPLOAD:-0}" == "1" ]]; then
  : "${ASC_KEY_ID:?set ASC_KEY_ID (App Store Connect API key id)}"
  : "${ASC_ISSUER_ID:?set ASC_ISSUER_ID (App Store Connect issuer id)}"
  echo "Uploading to App Store Connect ..."
  xcrun altool --upload-app --type ios --file "$IPA" \
    --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
  echo "Uploaded. It appears in TestFlight after Apple finishes processing (usually 5-20 minutes)."
else
  echo "Not uploaded. Drag the .ipa into the Transporter app, or re-run with UPLOAD=1 and an API key."
fi
