#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WAYPOINT_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-waypoint-permutation.XXXXXX")"
trap 'rm -rf "$WAYPOINT_HARNESS"' EXIT
mkdir -p "$WAYPOINT_HARNESS/backend/api/src/services/order" "$WAYPOINT_HARNESS/backend/api/src/config" \
 "$WAYPOINT_HARNESS/backend/api/src/middleware" "$WAYPOINT_HARNESS/backend/api/test/unit/services"
cp "${ROUTING_SERVICE_SOURCE:-$REPO_ROOT/backend/api/src/services/routingService.js}" "$WAYPOINT_HARNESS/backend/api/src/services/"
cp "$REPO_ROOT/backend/api/src/services/workZoneService.js" "$WAYPOINT_HARNESS/backend/api/src/services/"
cp "$REPO_ROOT/backend/api/src/services/order/domainError.js" "$WAYPOINT_HARNESS/backend/api/src/services/order/"
cp "$REPO_ROOT/backend/api/test/unit/waypointPermutation.test.js" "$WAYPOINT_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/test/unit/routingService.test.js" "$WAYPOINT_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/test/unit/services/routingService.test.js" "$WAYPOINT_HARNESS/backend/api/test/unit/services/"
cp "$REPO_ROOT/backend/api/eslint.config.js" "$WAYPOINT_HARNESS/backend/api/eslint.config.js"
printf '{"type":"module"}\n' > "$WAYPOINT_HARNESS/package.json"
printf 'export const redisClient = null; export const supabaseAdmin = null; export const supabase = null;\n' > "$WAYPOINT_HARNESS/backend/api/src/config/db.js"
printf 'export default {};\n' > "$WAYPOINT_HARNESS/backend/api/src/middleware/logger.js"
printf "export default {test:{include:['backend/api/test/unit/**/*.test.js'],environment:'node'}};\n" > "$WAYPOINT_HARNESS/vitest.config.mjs"
ln -s "$REPO_ROOT/tools/waypoint-permutation-tests/node_modules" "$WAYPOINT_HARNESS/node_modules"
(
 cd "$WAYPOINT_HARNESS/backend/api"
 "$REPO_ROOT/tools/waypoint-permutation-tests/node_modules/.bin/eslint" --no-config-lookup --config eslint.config.js \
 src/services/routingService.js test/unit/waypointPermutation.test.js
)
"$REPO_ROOT/tools/waypoint-permutation-tests/node_modules/.bin/vitest" run --root "$WAYPOINT_HARNESS" --config "$WAYPOINT_HARNESS/vitest.config.mjs" "$@"
