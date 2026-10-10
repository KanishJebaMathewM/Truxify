#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COLD_CHAIN_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-cold-chain-window.XXXXXX")"
trap 'rm -rf "$COLD_CHAIN_HARNESS"' EXIT
mkdir -p "$COLD_CHAIN_HARNESS/backend/api/src/services" \
 "$COLD_CHAIN_HARNESS/backend/api/src/core" \
 "$COLD_CHAIN_HARNESS/backend/api/src/config" "$COLD_CHAIN_HARNESS/backend/api/src/middleware" \
 "$COLD_CHAIN_HARNESS/backend/api/test/unit"
cp "${COLD_CHAIN_SERVICE_SOURCE:-$REPO_ROOT/backend/api/src/services/coldChainAnomalyService.js}" "$COLD_CHAIN_HARNESS/backend/api/src/services/"
cp "$REPO_ROOT/backend/api/test/unit/coldChainRedisWindow.test.js" "$COLD_CHAIN_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/eslint.config.js" "$COLD_CHAIN_HARNESS/backend/api/eslint.config.js"
printf '{"type":"module"}\n' > "$COLD_CHAIN_HARNESS/package.json"
printf 'export const redisClient = null; export const supabaseAdmin = null;\n' > "$COLD_CHAIN_HARNESS/backend/api/src/config/db.js"
cp "$REPO_ROOT/backend/api/src/core/performanceMetrics.js" "$COLD_CHAIN_HARNESS/backend/api/src/core/"
printf 'export async function sendPushNotification() {}\n' > "$COLD_CHAIN_HARNESS/backend/api/src/services/notificationService.js"
printf 'export default {};\n' > "$COLD_CHAIN_HARNESS/backend/api/src/middleware/logger.js"
printf "export default {test:{include:['backend/api/test/unit/*.test.js'],environment:'node',testTimeout:15000,hookTimeout:15000}};\n" > "$COLD_CHAIN_HARNESS/vitest.config.mjs"
ln -s "$REPO_ROOT/tools/cold-chain-window-tests/node_modules" "$COLD_CHAIN_HARNESS/node_modules"
(
 cd "$COLD_CHAIN_HARNESS/backend/api"
 "$REPO_ROOT/tools/cold-chain-window-tests/node_modules/.bin/eslint" --no-config-lookup --config eslint.config.js \
 src/services/coldChainAnomalyService.js test/unit/coldChainRedisWindow.test.js
)
"$REPO_ROOT/tools/cold-chain-window-tests/node_modules/.bin/vitest" run --root "$COLD_CHAIN_HARNESS" --config "$COLD_CHAIN_HARNESS/vitest.config.mjs" "$@"
