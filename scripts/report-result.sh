#!/usr/bin/env bash
# Report a build result to elrond's CI callback (WA-3) with a GitHub Actions
# OIDC token (W0-5). Elrond verifies the signature, issuer, audience, and the
# repository claim, so only this pipeline can report results.
#
# Usage: report-result.sh <callbackUrl> <buildId> <status> [bundleSha256] [sizeReportPath] [scanReportPath]
set -euo pipefail

CALLBACK_URL="$1"
BUILD_ID="$2"
STATUS="$3"
BUNDLE_SHA="${4:-}"
SIZE_REPORT="${5:-}"
SCAN_REPORT="${6:-}"

AUDIENCE="${ELROND_OIDC_AUDIENCE:-https://elrond.xola.app}"
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

# The workflow must have permissions: id-token: write for these to exist.
OIDC_TOKEN=$(curl -sS "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${AUDIENCE}" \
    -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" | node -p "JSON.parse(require('fs').readFileSync(0)).value")

BODY=$(node -e "
const fs = require('fs');
const body = { status: process.argv[1], logsUrl: process.argv[2] };
if (process.argv[3]) {
    body.bundleSha256 = process.argv[3];
    body.bundleUrl = process.env.BUNDLE_URL || undefined;
}
if (process.argv[4] && fs.existsSync(process.argv[4])) {
    body.sizeReport = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
}
if (process.argv[5] && fs.existsSync(process.argv[5])) {
    body.scanReport = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
}
console.log(JSON.stringify(body));
" "$STATUS" "$RUN_URL" "$BUNDLE_SHA" "$SIZE_REPORT" "$SCAN_REPORT")

HTTP_STATUS=$(curl -sS -o /tmp/callback-response.json -w "%{http_code}" \
    -X PUT "${CALLBACK_URL%/}/ci/builds/${BUILD_ID}" \
    -H "Authorization: Bearer ${OIDC_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$BODY")

echo "callback ${STATUS} -> ${HTTP_STATUS}"
cat /tmp/callback-response.json
if [ "$HTTP_STATUS" -ge 300 ]; then
    exit 1
fi
