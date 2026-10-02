#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TRAFFIC_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-traffic-ownership.XXXXXX")"
trap 'rm -rf "$TRAFFIC_HARNESS"' EXIT
mkdir -p "$TRAFFIC_HARNESS/backend/api/src/services" "$TRAFFIC_HARNESS/backend/api/src/lib" \
 "$TRAFFIC_HARNESS/backend/api/src/config" "$TRAFFIC_HARNESS/backend/api/src/middleware" \
 "$TRAFFIC_HARNESS/backend/api/test/unit"
cp "${TRAFFIC_SERVICE_SOURCE:-$REPO_ROOT/backend/api/src/services/trafficService.js}" "$TRAFFIC_HARNESS/backend/api/src/services/"
cp "$REPO_ROOT/backend/api/src/lib/trafficProviderFlights.js" "$TRAFFIC_HARNESS/backend/api/src/lib/"
cp "$REPO_ROOT/backend/api/test/unit/trafficProviderOwnership.test.js" "$TRAFFIC_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/eslint.config.js" "$TRAFFIC_HARNESS/backend/api/eslint.config.js"
printf '{"type":"module"}\n' > "$TRAFFIC_HARNESS/package.json"
printf 'export const redisClient = null;\n' > "$TRAFFIC_HARNESS/backend/api/src/config/db.js"
printf 'export default {};\n' > "$TRAFFIC_HARNESS/backend/api/src/middleware/logger.js"
printf "export default {test:{include:['backend/api/test/unit/*.test.js'],environment:'node',testTimeout:15000}};\n" > "$TRAFFIC_HARNESS/vitest.config.mjs"
ln -s "$REPO_ROOT/tools/traffic-ownership-tests/node_modules" "$TRAFFIC_HARNESS/node_modules"
(
 cd "$TRAFFIC_HARNESS/backend/api"
 "$REPO_ROOT/tools/traffic-ownership-tests/node_modules/.bin/eslint" --no-config-lookup --config eslint.config.js \
 src/services/trafficService.js src/lib/trafficProviderFlights.js test/unit/trafficProviderOwnership.test.js
)
"$REPO_ROOT/tools/traffic-ownership-tests/node_modules/.bin/vitest" run --root "$TRAFFIC_HARNESS" --config "$TRAFFIC_HARNESS/vitest.config.mjs" "$@"
