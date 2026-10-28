#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
runner="$root/tools/telemetry-bulk-tests"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/src/sockets" "$fixture/src/config" "$fixture/src/middleware" "$fixture/test/unit/fixtures"
cp "${TELEMETRY_BASELINE_SOURCE:-$root/backend/api/src/sockets/telemetryBuffer.js}" "$fixture/src/sockets/telemetryBuffer.js"
cp "$root/backend/api/src/sockets/telemetryBulkOutcome.js" "$fixture/src/sockets/"
cp "$root/backend/api/test/unit/telemetryBulkRecovery.test.js" "$fixture/test/unit/"
cp "$root/backend/api/test/unit/fixtures/mongoBulkWire.js" "$fixture/test/unit/fixtures/"
cp "$root/backend/api/eslint.config.js" "$fixture/"
printf '%s\n' '{"type":"module"}' > "$fixture/package.json"
printf '%s\n' 'export const mongoDb=null;' > "$fixture/src/config/db.js"
printf '%s\n' 'export default {info(){},warn(){},error(){}};' > "$fixture/src/middleware/logger.js"
ln -s "$runner/node_modules" "$fixture/node_modules"
cd "$fixture"
"$runner/node_modules/.bin/vitest" run test/unit/telemetryBulkRecovery.test.js "$@"
"$runner/node_modules/.bin/eslint" src/sockets/telemetryBuffer.js src/sockets/telemetryBulkOutcome.js test/unit/telemetryBulkRecovery.test.js test/unit/fixtures/mongoBulkWire.js --max-warnings 0
