#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tools_dir="$root/tools/telemetry-shutdown-tests"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/src/sockets" "$fixture/src/middleware" "$fixture/src/config" "$fixture/test/unit"
cp "$root/backend/api/src/sockets/"*.js "$fixture/src/sockets/"
cp "${TELEMETRY_BASELINE_SOURCE:-$root/backend/api/src/sockets/telemetryBuffer.js}" "$fixture/src/sockets/telemetryBuffer.js"
cp "$root/backend/api/test/unit/telemetryShutdown.test.js" "$fixture/test/unit/"
cp "$root/backend/api/eslint.config.js" "$fixture/"
printf '%s\n' '{"type":"module"}' > "$fixture/package.json"
printf '%s\n' 'export default {info(){},warn(){},error(){}};' > "$fixture/src/middleware/logger.js"
printf '%s\n' 'export const mongoDb = null;' > "$fixture/src/config/db.js"
ln -s "$tools_dir/node_modules" "$fixture/node_modules"
cd "$fixture"
"$tools_dir/node_modules/.bin/vitest" run test/unit/telemetryShutdown.test.js "$@"
"$tools_dir/node_modules/.bin/eslint" src/sockets/telemetryBuffer.js test/unit/telemetryShutdown.test.js --max-warnings 0
